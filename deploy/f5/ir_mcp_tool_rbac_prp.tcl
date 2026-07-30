# ir_mcp_tool_rbac_prp — Tier 2 Tool ACL (PRP iRule Event / primary)
#
# Lab constraints (BIG-IP 21.1 compiler — error 01070151):
#   1) ACCESS::perflow ONLY under perflow.custom.* | perflow.scratchpad.* | …
#   2) ACCESS::perflow NOT valid in JSON_REQUEST
#   3) JSON::root / JSON::get NOT valid in ACCESS_PER_REQUEST_AGENT_EVENT
#      (catch{} does NOT bypass compile-time event checks)
#
# Therefore this rule parses MCP JSON-RPC with HTTP::payload + regexp only.
# Attach to Per-Request Policy "iRule Event" agent (ACCESS_PER_REQUEST_AGENT_EVENT).
#
# Requires: Data Group dg_mcp_tool_allow with keys "{mcp_role}/{tool_name}"
# Do NOT use HTTP::respond (conflicts with JSON/SSE/AIMCP).

when ACCESS_PER_REQUEST_AGENT_EVENT {
    set tool_name ""
    set method ""

    set payload ""
    catch { set payload [HTTP::payload] }

    # Demo bodies are small single-frame JSON; production may need HTTP::collect.
    # Keep regex simple to avoid Tcl parser edge cases with nested braces.
    if { [regexp {"method"\s*:\s*"([^"]+)"} $payload -> method] } {
        if { $method eq "tools/call" } {
            # Use the first name field in tools/call payload for demo purpose.
            regexp {"name"\s*:\s*"([^"]+)"} $payload -> tool_name
        }
    }

    ACCESS::perflow set perflow.custom.mcp_tool_name $tool_name

    # Non-tools/call (initialize, tools/list, ...): allow without DG lookup
    if { $tool_name eq "" } {
        ACCESS::perflow set perflow.custom.mcp_tool_decision "allow"
        log local0. "mcp_tier2: passthrough method=$method (no tool)"
        return
    }

    set role ""
    catch { set role [ACCESS::session data get "session.oauth.scope.last.jwt.mcp_role"] }
    if { $role eq "" } {
        catch { set role [mcget {session.oauth.scope.last.jwt.mcp_role}] }
    }
    if { $role eq "" } {
        # PRP / subsession namespace fallback — confirm with sessiondump
        catch { set role [mcget {subsession.oauth.scope.last.jwt.mcp_role}] }
    }

    set key "$role/$tool_name"
    if { $role ne "" && [class match $key equals dg_mcp_tool_allow] } {
        ACCESS::perflow set perflow.custom.mcp_tool_decision "allow"
        log local0. "mcp_tier2: ALLOW key=$key"
    } else {
        ACCESS::perflow set perflow.custom.mcp_tool_decision "deny"
        log local0. "mcp_tier2: DENY key=$key role=$role tool=$tool_name"
    }
}
