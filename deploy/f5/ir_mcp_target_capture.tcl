when ACCESS_SESSION_STARTED {
    set target_server [HTTP::header value "X-Mcp-Target-Server"]
    if { $target_server eq "" } {
        set target_server "unspecified"
    }
    ACCESS::session data set session.custom.target_server $target_server
}
