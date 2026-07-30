# ir_mcp_tool_rbac_ltm — Tier 2 Tool ACL (Path C / LTM JSON_REQUEST)
#
# Syntax aligned with ir_mcp_audit_logger JSON handling style:
#   JSON::type / JSON::get <json> object / JSON::object get / JSON::get <json> string
#
# Attach to VS Resources → iRules (requires mcp_json_profile).
# Requires: Data Group dg_mcp_tool_allow keys "{mcp_role}/{tool_name}"
# Do NOT use HTTP::respond (conflicts with JSON/SSE/AIMCP).

proc mcp_b64url_decode {s} {
    set pad [expr {(4 - ([string length $s] % 4)) % 4}]
    set s "$s[string repeat = $pad]"
    set s [string map {- + _ /} $s]
    return [b64decode $s]
}

# Parse mcp_role from JWT payload text (string claim only)
proc mcp_jwt_role {jwt} {
    set parts [split $jwt "."]
    if { [llength $parts] < 2 } { return "" }

    if { [catch {
        set payload [call mcp_b64url_decode [lindex $parts 1]]
    }] } {
        return ""
    }

    # Use brace-quoted regexp to avoid Tcl quote parsing issues.
    if { [regexp {"mcp_role"\s*:\s*"([^"]*)"} $payload -> role] } {
        return $role
    }
    return ""
}

when JSON_REQUEST {
    set method ""
    set tool_name ""

    catch {
        set root [JSON::root]
        if { $root eq "" } { return }
        if { [JSON::type $root] ne "object" } { return }

        set jobj [JSON::get $root object]
        set jobj_keys [JSON::object keys $jobj]

        if { [lsearch -exact $jobj_keys method] >= 0 } {
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

    # Non-tools/call: keep Tier 1 routing result
    if { $tool_name eq "" } {
        log local0. "mcp_tier2_ltm: passthrough method=$method"
        return
    }

    set auth [HTTP::header value "Authorization"]
    set role ""
    if { [string match -nocase "Bearer *" $auth] } {
        set jwt [string trim [string range $auth 7 end]]
        set role [call mcp_jwt_role $jwt]
    }

    set key "$role/$tool_name"
    if { $role ne "" && [class match $key equals dg_mcp_tool_allow] } {
        log local0. "mcp_tier2_ltm: ALLOW key=$key"
        return
    }

    log local0. "mcp_tier2_ltm: DENY key=$key role=$role tool=$tool_name"
    pool pool_mcp_ctl_deny
}
