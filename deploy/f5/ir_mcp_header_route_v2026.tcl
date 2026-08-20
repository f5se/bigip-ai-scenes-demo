# Optional debug iRule — NOT attached to VS by default.
# Header logging is already in ir_mcp_audit_logger_v2026 and
# ir_mcp_tools_control_rbac_v2026. Keep this file only if you want a
# standalone logger during lab bring-up.

when HTTP_REQUEST {
    set proto [HTTP::header value "MCP-Protocol-Version"]
    set method [HTTP::header value "Mcp-Method"]
    set name [HTTP::header value "Mcp-Name"]
    log local0. "mcp2026 headers proto=$proto method=$method name=$name agent=[HTTP::header value X-Agent-Identity]"
}
