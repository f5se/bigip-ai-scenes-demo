# ir_mcp_tools_control_rbac_v2026 — OPTIONAL LTM-only Tier 1 (no APM)
#
# Live Demo vs_mcp_tools_control_v2026_07_28 (:9021) does NOT attach this iRule.
# Tier 1 is the same APM Access Profile as :9010: ap_mcp_tools_control_rs.
#
# This is a 2026-named copy of ir_mcp_tools_control_rbac for a VS that cannot
# use APM. Policy input is unchanged (JWT mcp_groups + X-Mcp-Target-Server).
# Pools reuse pool_mcp_ctl_ops / _finance / _deny.
# Do NOT attach together with APM (pool would be overwritten).

proc mcp_b64url_decode_v2026 {s} {
    set pad [expr {(4 - ([string length $s] % 4)) % 4}]
    set s "$s[string repeat = $pad]"
    set s [string map {- + _ /} $s]
    return [b64decode $s]
}

when HTTP_REQUEST {
    set proto [HTTP::header value "MCP-Protocol-Version"]
    set method [HTTP::header value "Mcp-Method"]
    set target [string tolower [HTTP::header value "X-Mcp-Target-Server"]]
    if { $target eq "" } { set target "unspecified" }

    set auth [HTTP::header value "Authorization"]
    set groups ""
    if { [string match -nocase "Bearer *" $auth] } {
        set jwt [string trim [string range $auth 7 end]]
        set parts [split $jwt "."]
        if { [llength $parts] >= 2 } {
            if { [catch {
                set payload [call mcp_b64url_decode_v2026 [lindex $parts 1]]
                if { [regexp {"mcp_groups"\s*:\s*"([^"]*)"} $payload -> g] } {
                    set groups $g
                } elseif { [regexp {"mcp_groups"\s*:\s*\[([^\]]*)]} $payload -> g] } {
                    set groups $g
                } elseif { [regexp {"groups"\s*:\s*"([^"]*)"} $payload -> g] } {
                    set groups $g
                }
            } err] } {
                log local0. "mcp_ctl_v2026: jwt decode error: $err"
            }
        }
    }

    set allow 0
    set pool_name "pool_mcp_ctl_deny"
    if { $target eq "ops" && [string match "*grp_mcp_ops*" $groups] } {
        set allow 1
        set pool_name "pool_mcp_ctl_ops"
    } elseif { $target eq "finance" && [string match "*grp_mcp_finance*" $groups] } {
        set allow 1
        set pool_name "pool_mcp_ctl_finance"
    }

    if { $allow } {
        log local0. "mcp_ctl_v2026: ALLOW proto=$proto method=$method target=$target pool=$pool_name groups=$groups"
    } else {
        log local0. "mcp_ctl_v2026: DENY proto=$proto method=$method target=$target pool=$pool_name groups=$groups agent=[HTTP::header value X-Agent-Identity]"
    }
    pool $pool_name
}
