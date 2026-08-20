# ir_mcp_tool_rbac_ltm_v2026 — Tier 2 Tool ACL for MCP 2026-07-28
#
# Independent of ir_mcp_tool_rbac_ltm. Attach ONLY to vs_mcp_tools_control_v2026_07_28.
# Prefer Mcp-Name / Mcp-Method headers; JSON params.name is fallback.
#
# Reused with :9010: Data Group dg_mcp_tool_allow, fail-close pool_mcp_ctl_deny.
# Tier 1 (server ACL) stays on APM Access Profile ap_mcp_tools_control_rs — this
# iRule only overrides the pool on tools/call deny.

proc mcp_b64url_decode_t2_v2026 {s} {
    set pad [expr {(4 - ([string length $s] % 4)) % 4}]
    set s "$s[string repeat = $pad]"
    set s [string map {- + _ /} $s]
    return [b64decode $s]
}

when JSON_REQUEST {
    set method [HTTP::header value "Mcp-Method"]
    set tool_name [HTTP::header value "Mcp-Name"]

    if { $tool_name eq "" } {
        catch {
            set root [JSON::root]
            if { $root eq "" } { return }
            if { [JSON::type $root] ne "object" } { return }
            set jobj [JSON::get $root object]
            set jobj_keys [JSON::object keys $jobj]
            if { $method eq "" && [lsearch -exact $jobj_keys method] >= 0 } {
                set method_elem [JSON::object get $jobj "method"]
                if { $method_elem ne "" && [JSON::type $method_elem] eq "string" } {
                    set method [JSON::get $method_elem string]
                }
            }
            if { $method eq "tools/call" && [lsearch -exact $jobj_keys params] >= 0 } {
                set params_elem [JSON::object get $jobj "params"]
                if { $params_elem ne "" && [JSON::type $params_elem] eq "object" } {
                    set params_obj [JSON::get $params_elem object]
                    if { [lsearch -exact [JSON::object keys $params_obj] name] >= 0 } {
                        set name_elem [JSON::object get $params_obj "name"]
                        if { $name_elem ne "" && [JSON::type $name_elem] eq "string" } {
                            set tool_name [JSON::get $name_elem string]
                        }
                    }
                }
            }
        }
    }

    if { $tool_name eq "" } {
        log local0. "mcp_tier2_v2026: passthrough method=$method"
        return
    }

    set auth [HTTP::header value "Authorization"]
    set role ""
    if { [string match -nocase "Bearer *" $auth] } {
        set jwt [string trim [string range $auth 7 end]]
        set parts [split $jwt "."]
        if { [llength $parts] >= 2 } {
            catch {
                set payload [call mcp_b64url_decode_t2_v2026 [lindex $parts 1]]
                regexp {"mcp_role"\s*:\s*"([^"]*)"} $payload -> role
            }
        }
    }

    set key "$role/$tool_name"
    if { $role ne "" && [class match $key equals dg_mcp_tool_allow] } {
        log local0. "mcp_tier2_v2026: ALLOW key=$key proto=[HTTP::header value MCP-Protocol-Version]"
        return
    }
    log local0. "mcp_tier2_v2026: DENY key=$key role=$role tool=$tool_name"
    pool pool_mcp_ctl_deny
}
