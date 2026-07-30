# ir_mcp_tools_control_rbac — Tier 1 Server ACL via JWT mcp_groups + X-Mcp-Target-Server
# Deny path uses pool_mcp_ctl_deny (403 stub) because HTTP::respond conflicts with JSON/SSE/AIMCP profiles.

proc mcp_b64url_decode {s} {
    set pad [expr {(4 - ([string length $s] % 4)) % 4}]
    set s "$s[string repeat = $pad]"
    set s [string map {- + _ /} $s]
    return [b64decode $s]
}

when HTTP_REQUEST {
    set target [string tolower [HTTP::header value "X-Mcp-Target-Server"]]
    if { $target eq "" } { set target "unspecified" }

    set auth [HTTP::header value "Authorization"]
    set groups ""
    if { [string match -nocase "Bearer *" $auth] } {
        set jwt [string trim [string range $auth 7 end]]
        set parts [split $jwt "."]
        if { [llength $parts] >= 2 } {
            if { [catch {
                set payload [call mcp_b64url_decode [lindex $parts 1]]
                if { [regexp {"mcp_groups"\s*:\s*"([^"]*)"} $payload -> g] } {
                    set groups $g
                } elseif { [regexp {"mcp_groups"\s*:\s*\[([^\]]*)]} $payload -> g] } {
                    set groups $g
                } elseif { [regexp {"groups"\s*:\s*"([^"]*)"} $payload -> g] } {
                    set groups $g
                }
            } err] } {
                log local0. "mcp_ctl: jwt decode error: $err"
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
        log local0. "mcp_ctl: ALLOW target=$target pool=$pool_name groups=$groups"
    } else {
        log local0. "mcp_ctl: DENY target=$target pool=$pool_name groups=$groups agent=[HTTP::header value X-Agent-Identity]"
    }
    pool $pool_name
}
