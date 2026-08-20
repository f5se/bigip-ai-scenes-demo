# ir_mcp_audit_logger_v2026 — MCP 2026-07-28 audit (independent of ir_mcp_audit_logger)
#
# Header-first: Mcp-Method / Mcp-Name / MCP-Protocol-Version.
# JSON body is fallback only (clients that omit routing headers).
# Attach ONLY to vs_mcp_insight_v2026_07_28 / vs_mcp_tools_control_v2026_07_28.
#
# Shared with legacy (intentionally):
#   - iRuleLX plugin mcp_audit_lx_plugin / mcp_audit_ext (Adapter 投递通道)
#   - Data Group / OAuth AS are not used by this iRule
#
# Do NOT attach this iRule to :9000 / :9010.

when RULE_INIT {
    set static::SCHEMA_VERSION "mcp_v1"
    set static::LOG_PARAMS_SUMMARY 1
    set static::MAX_PARAMS_LEN 512
    set static::LOG_SSE_EVENTS 1
    set static::MCP_DENY_STUB_PORT "9003"
    set static::MCP_PROTO_DEFAULT "2026-07-28"
}

when HTTP_REQUEST {
    set mcp_http_method [HTTP::method]
    if { $mcp_http_method ne "POST" } { return }

    set static::ILX_HANDLE [ILX::init mcp_audit_lx_plugin mcp_audit_ext]
    set mcp_trace_id "mcp-[clock clicks -milliseconds]-[expr {int(rand()*99999)}]"
    set mcp_req_start_ms [clock clicks -milliseconds]
    set mcp_agent_identity [HTTP::header value "X-Agent-Identity"]
    if { $mcp_agent_identity eq "" } { set mcp_agent_identity "unknown" }
    set mcp_tenant_id [HTTP::header value "X-Tenant-Id"]
    if { $mcp_tenant_id eq "" } { set mcp_tenant_id "default" }
    set mcp_session_id [HTTP::header value "Mcp-Session-Id"]
    if { $mcp_session_id eq "" } { set mcp_session_id "stateless" }
    set mcp_protocol_version [HTTP::header value "MCP-Protocol-Version"]
    if { $mcp_protocol_version eq "" } { set mcp_protocol_version $static::MCP_PROTO_DEFAULT }
    set mcp_jsonrpc_method [HTTP::header value "Mcp-Method"]
    set mcp_tool_name [HTTP::header value "Mcp-Name"]
    set mcp_client_ip [IP::client_addr]
    set mcp_jsonrpc_id ""
    set mcp_params_summary "headers method=$mcp_jsonrpc_method name=$mcp_tool_name"
    set mcp_message_type "unknown"
    set mcp_pool_member ""
    set mcp_sse_event_count 0
    set mcp_sse_sampling_count 0
    set mcp_sse_elicitation_count 0
    set mcp_mrtr 0
    set mcp_final_result_error ""
    set mcp_resp_type "json"
    set mcp_role ""
    set mcp_deny_reason ""

    set auth [HTTP::header value "Authorization"]
    if { [string match -nocase {Bearer *} $auth] } {
        set jwt [string trim [string range $auth 7 end]]
        set parts [split $jwt "."]
        if { [llength $parts] >= 2 } {
            set seg [lindex $parts 1]
            set pad_n [expr { (4 - ([string length $seg] % 4)) % 4 }]
            set seg "$seg[string repeat = $pad_n]"
            set seg [string map {- + _ /} $seg]
            if { ![catch { set payload [b64decode $seg] }] } {
                regexp {"mcp_role"\s*:\s*"([^"]*)"} $payload -> mcp_role
            }
        }
    }

    log local0. "mcp_audit_v2026: proto=$mcp_protocol_version method=$mcp_jsonrpc_method name=$mcp_tool_name agent=$mcp_agent_identity"
}

when JSON_REQUEST {
    if { [HTTP::method] ne "POST" } { return }
    catch {
        set root [JSON::root]
        if { $root eq "" } { return }
        if { [JSON::type $root] ne "object" } { return }
        set jobj [JSON::get $root object]
        set jobj_keys [JSON::object keys $jobj]

        if { $mcp_jsonrpc_method eq "" && [lsearch -exact $jobj_keys method] >= 0 } {
            set _mn [JSON::object get $jobj "method"]
            if { $_mn ne "" && [JSON::type $_mn] eq "string" } {
                set mcp_jsonrpc_method [JSON::get $_mn string]
            }
        }

        if { [lsearch -exact $jobj_keys params] >= 0 } {
            set params_elem [JSON::object get $jobj "params"]
            if { $params_elem ne "" && [JSON::type $params_elem] eq "object" } {
                set params_obj [JSON::get $params_elem object]
                set pkeys [JSON::object keys $params_obj]
                if { $mcp_tool_name eq "" && [lsearch -exact $pkeys name] >= 0 } {
                    set name_elem [JSON::object get $params_obj "name"]
                    if { $name_elem ne "" && [JSON::type $name_elem] eq "string" } {
                        set mcp_tool_name [JSON::get $name_elem string]
                    }
                }
                if { $mcp_tool_name eq "" && [lsearch -exact $pkeys uri] >= 0 } {
                    set uri_elem [JSON::object get $params_obj "uri"]
                    if { $uri_elem ne "" && [JSON::type $uri_elem] eq "string" } {
                        set mcp_tool_name [JSON::get $uri_elem string]
                    }
                }
                if { $static::LOG_PARAMS_SUMMARY && [lsearch -exact $pkeys arguments] >= 0 } {
                    set args_elem [JSON::object get $params_obj "arguments"]
                    if { $args_elem ne "" } {
                        set mcp_params_summary "tool=$mcp_tool_name,args=[string range [JSON::render $args_elem] 0 $static::MAX_PARAMS_LEN]"
                    }
                }
                if { [lsearch -exact $pkeys inputResponses] >= 0 } {
                    set mcp_params_summary "$mcp_params_summary,mrtr=inputResponses"
                    set mcp_mrtr 1
                }
            }
        }

        set mcp_jsonrpc_id ""
        if { [lsearch -exact $jobj_keys id] >= 0 } {
            set _in [JSON::object get $jobj "id"]
            if { $_in ne "" } {
                set _type [JSON::type $_in]
                if { $_type eq "string" } {
                    set mcp_jsonrpc_id [JSON::get $_in string]
                } elseif { $_type eq "integer" } {
                    set mcp_jsonrpc_id [JSON::get $_in integer]
                } else {
                    set mcp_jsonrpc_id [JSON::render $_in]
                }
            }
        }
    }

    switch -glob $mcp_jsonrpc_method {
        "initialize"                { set mcp_message_type "lifecycle.discover" }
        "server/discover"           { set mcp_message_type "lifecycle.discover" }
        "notifications/initialized" { set mcp_message_type "lifecycle.initialized" }
        "tools/list"                { set mcp_message_type "discovery.tools_list" }
        "prompts/list"              { set mcp_message_type "discovery.prompts_list" }
        "resources/list"            { set mcp_message_type "discovery.resources_list" }
        "tools/call"                { set mcp_message_type "tool.call" }
        "prompts/get"               { set mcp_message_type "prompts.get" }
        "resources/read"            { set mcp_message_type "resources.read" }
        "ping"                      { set mcp_message_type "control.ping" }
        default {
            if { $mcp_jsonrpc_method eq "" } {
                set mcp_message_type "unknown"
            } else {
                set mcp_message_type "other.$mcp_jsonrpc_method"
            }
        }
    }
}

when JSON_RESPONSE {
    if { [HTTP::method] ne "POST" } { return }
    catch {
        set root [JSON::root]
        if { $root eq "" } { return }
        if { [JSON::type $root] ne "object" } { return }
        set jobj [JSON::get $root object]
        if { [lsearch -exact [JSON::object keys $jobj] result] < 0 } { return }
        set result_elem [JSON::object get $jobj "result"]
        if { $result_elem eq "" || [JSON::type $result_elem] ne "object" } { return }
        set result_obj [JSON::get $result_elem object]
        if { [lsearch -exact [JSON::object keys $result_obj] resultType] < 0 } { return }
        set rt_elem [JSON::object get $result_obj "resultType"]
        if { $rt_elem eq "" || [JSON::type $rt_elem] ne "string" } { return }
        set rt [JSON::get $rt_elem string]
        if { $rt eq "input_required" } {
            set mcp_mrtr 1
            set mcp_params_summary "$mcp_params_summary,resultType=input_required"
            incr mcp_sse_sampling_count
        }
    }
}

when LB_SELECTED {
    set mcp_pool_member "[LB::server addr]:[LB::server port]"
}

when HTTP_RESPONSE {
    set ct [HTTP::header value "Content-Type"]
    if { [string match {*text/event-stream*} $ct] } {
        set mcp_resp_type "sse_stream"
    } else {
        set mcp_resp_type "json"
    }
}

when SSE_RESPONSE {
    if { !$static::LOG_SSE_EVENTS } { return }
    incr mcp_sse_event_count
    set sse_data [SSE::field get data]
    if { $sse_data eq "" } { return }

    set _sse_jsonrpc_id ""
    regexp {"id"\s*:\s*([0-9]+)} $sse_data -> _sse_jsonrpc_id
    set _role $mcp_role
    regsub -all {\\} $_role {\\\\} _role
    regsub -all {"} $_role {\"} _role
    set _proto $mcp_protocol_version
    regsub -all {\\} $_proto {\\\\} _proto
    regsub -all {"} $_proto {\"} _proto

    if { [string match {*"method"*"sampling/createMessage"*} $sse_data] } {
        incr mcp_sse_sampling_count
        set _sampling_ps "unexpected-sse,sampling/createMessage"
        regsub -all {\\} $_sampling_ps {\\\\} _sampling_ps
        regsub -all {"} $_sampling_ps {\"} _sampling_ps
        set _log_json "\{\"schema_version\":\"$static::SCHEMA_VERSION\",\
\"event_type\":\"mcp_sse_sampling_request\",\
\"event_time\":\"[clock format [clock seconds] -format {%Y-%m-%dT%H:%M:%SZ} -gmt true]\",\
\"trace_id\":\"${mcp_trace_id}-sampling\",\
\"mcp_session_id\":\"$mcp_session_id\",\
\"agent_identity\":\"$mcp_agent_identity\",\
\"tenant_id\":\"$mcp_tenant_id\",\
\"client_ip\":\"$mcp_client_ip\",\
\"message_type\":\"server.sampling_request\",\
\"tool_name\":\"$mcp_tool_name\",\
\"jsonrpc_id\":\"$_sse_jsonrpc_id\",\
\"params_summary\":\"$_sampling_ps\",\
\"latency_ms\":0,\
\"status\":\"success\",\
\"error_info\":\"\",\
\"mcp_role\":\"$_role\",\
\"deny_reason\":\"\",\
\"mcp_protocol_version\":\"$_proto\",\
\"http_method\":\"$mcp_http_method\",\
\"pool_member\":\"$mcp_pool_member\",\
\"sse_event_count\":$mcp_sse_event_count,\
\"sse_sampling_count\":$mcp_sse_sampling_count,\
\"sse_elicitation_count\":$mcp_sse_elicitation_count\}"
        catch { ILX::notify $static::ILX_HANDLE send_mcp_log $_log_json }

    } elseif { [string match {*"method"*"elicitation/create"*} $sse_data] } {
        incr mcp_sse_elicitation_count
        set _elic_ps "unexpected-sse,elicitation/create"
        regsub -all {\\} $_elic_ps {\\\\} _elic_ps
        regsub -all {"} $_elic_ps {\"} _elic_ps
        set _log_json "\{\"schema_version\":\"$static::SCHEMA_VERSION\",\
\"event_type\":\"mcp_sse_elicitation_request\",\
\"event_time\":\"[clock format [clock seconds] -format {%Y-%m-%dT%H:%M:%SZ} -gmt true]\",\
\"trace_id\":\"${mcp_trace_id}-elicitation\",\
\"mcp_session_id\":\"$mcp_session_id\",\
\"agent_identity\":\"$mcp_agent_identity\",\
\"tenant_id\":\"$mcp_tenant_id\",\
\"client_ip\":\"$mcp_client_ip\",\
\"message_type\":\"server.elicitation_request\",\
\"tool_name\":\"$mcp_tool_name\",\
\"jsonrpc_id\":\"$_sse_jsonrpc_id\",\
\"params_summary\":\"$_elic_ps\",\
\"latency_ms\":0,\
\"status\":\"success\",\
\"error_info\":\"\",\
\"mcp_role\":\"$_role\",\
\"deny_reason\":\"\",\
\"mcp_protocol_version\":\"$_proto\",\
\"http_method\":\"$mcp_http_method\",\
\"pool_member\":\"$mcp_pool_member\",\
\"sse_event_count\":$mcp_sse_event_count,\
\"sse_sampling_count\":$mcp_sse_sampling_count,\
\"sse_elicitation_count\":$mcp_sse_elicitation_count\}"
        catch { ILX::notify $static::ILX_HANDLE send_mcp_log $_log_json }
    }
}

when HTTP_RESPONSE_RELEASE {
    if { $mcp_http_method ne "POST" } { return }
    if { $mcp_resp_type eq "sse_stream" } { return }
    set mcp_latency_ms [expr {[clock clicks -milliseconds] - $mcp_req_start_ms}]
    if { [HTTP::status] >= 400 } { set mcp_final_result_error "http_[HTTP::status]" }

    set mcp_deny_reason ""
    set _is_fail_close 0
    if { $mcp_final_result_error eq "http_403" } { set _is_fail_close 1 }
    if { [string match "*:$static::MCP_DENY_STUB_PORT" $mcp_pool_member] } { set _is_fail_close 1 }
    if { $_is_fail_close } {
        if { $mcp_message_type eq "tool.call" } {
            set mcp_deny_reason "tier2_tool_acl"
        } else {
            set mcp_deny_reason "tier1_server_acl"
        }
    }

    set _ps $mcp_params_summary
    regsub -all {\\} $_ps {\\\\} _ps
    regsub -all {"} $_ps {\"} _ps
    set _tn $mcp_tool_name
    regsub -all {\\} $_tn {\\\\} _tn
    regsub -all {"} $_tn {\"} _tn
    set _role $mcp_role
    regsub -all {\\} $_role {\\\\} _role
    regsub -all {"} $_role {\"} _role
    set _deny $mcp_deny_reason
    regsub -all {\\} $_deny {\\\\} _deny
    regsub -all {"} $_deny {\"} _deny
    set _proto $mcp_protocol_version
    regsub -all {\\} $_proto {\\\\} _proto
    regsub -all {"} $_proto {\"} _proto
    set _status [expr { $mcp_final_result_error ne "" ? "error" : "success" }]
    set _log_json "\{\"schema_version\":\"$static::SCHEMA_VERSION\",\
\"event_type\":\"mcp_request_completed\",\
\"event_time\":\"[clock format [clock seconds] -format {%Y-%m-%dT%H:%M:%SZ} -gmt true]\",\
\"trace_id\":\"$mcp_trace_id\",\
\"mcp_session_id\":\"$mcp_session_id\",\
\"agent_identity\":\"$mcp_agent_identity\",\
\"tenant_id\":\"$mcp_tenant_id\",\
\"client_ip\":\"$mcp_client_ip\",\
\"message_type\":\"$mcp_message_type\",\
\"tool_name\":\"$_tn\",\
\"jsonrpc_id\":\"$mcp_jsonrpc_id\",\
\"params_summary\":\"$_ps\",\
\"latency_ms\":$mcp_latency_ms,\
\"status\":\"$_status\",\
\"error_info\":\"$mcp_final_result_error\",\
\"mcp_role\":\"$_role\",\
\"deny_reason\":\"$_deny\",\
\"mcp_protocol_version\":\"$_proto\",\
\"http_method\":\"$mcp_http_method\",\
\"pool_member\":\"$mcp_pool_member\",\
\"sse_event_count\":$mcp_sse_event_count,\
\"sse_sampling_count\":$mcp_sse_sampling_count,\
\"sse_elicitation_count\":$mcp_sse_elicitation_count\}"
    catch { ILX::notify $static::ILX_HANDLE send_mcp_log $_log_json }
}
