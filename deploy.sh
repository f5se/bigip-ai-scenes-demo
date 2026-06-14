#!/bin/bash
# =============================================================================
# deploy.sh — BIG-IP iRuleLX LLM Router Deployment Script
#
# Run this script ON the BIG-IP bash shell, or adapt each tmsh block
# to your automation toolchain (Ansible / AS3 / Terraform).
#
# Prerequisites:
#   - BIG-IP TMOS v13.0+ (iRuleLX Streaming support)
#   - BIG-IP TMOS v21 recommended (tested target)
#   - LTM pools for each model backend must already exist
#   - Script must be run as root or with tmsh access
#
# Deployment order (dependencies):
#   Step 1 : Create LTM Pools (skip if already exist)
#   Step 2 : Create Data Group
#   Step 3 : Upload & create iRuleLX Workspace + Plugin
#   Step 4 : Associate Data Group to Plugin
#   Step 5 : Create ILX Profile
#   Step 6 : Configure Virtual Server
#   Step 7 : Verify
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# User-configurable variables — adjust before running
# ---------------------------------------------------------------------------

PARTITION="Common"
VS_NAME="vs_llm_inferecen_gateway"
VS_IP="172.16.30.122"          # Virtual Server IP
VS_PORT="8000"               # Virtual Server port (443 for HTTPS offload)
HTTP_PROFILE="http"         # HTTP profile name (use 'http' for plain HTTP)
                            # For HTTPS offload: use your SSL profile names separately
SSL_CLIENT_PROFILE=""       # e.g. "clientssl"  — leave empty if HTTP only
SSL_SERVER_PROFILE=""       # e.g. "serverssl"  — leave empty if HTTP only

PLUGIN_NAME="llm_router_plugin"
EXT_NAME="llm_router"
ILX_PROFILE_NAME="llm_router_ilx_profile"
DG_NAME="llm_model_pool_map"

WORKSPACE_ARCHIVE="/tmp/llm_router_ext.tgz"   # path to the uploaded tgz

# ---------------------------------------------------------------------------
# Step 1: Create backend LTM Pools (ve21 实际环境)
# 成员节点 ubuntu-ai → 172.16.40.122，端口名对应测试推理服务监听端口
# ---------------------------------------------------------------------------
BACKEND_NODE="ubuntu-ai"
BACKEND_ADDR="172.16.40.122"

echo "==> Step 1: Creating LTM Pools..."

tmsh create ltm pool /Common/pool_gpt-4o \
    members add { ${BACKEND_NODE}:vcom-tunnel { address ${BACKEND_ADDR} } } || true

tmsh create ltm pool /Common/pool_gpt-4o-mini \
    members add { ${BACKEND_NODE}:teradataordbms { address ${BACKEND_ADDR} } } || true

tmsh create ltm pool /Common/pool_gpt-3.5-turbo \
    members add { ${BACKEND_NODE}:mcreport { address ${BACKEND_ADDR} } } || true

tmsh create ltm pool /Common/pool_gemini-1.5-pro \
    members add { ${BACKEND_NODE}:8004 { address ${BACKEND_ADDR} } } || true

tmsh create ltm pool /Common/pool_deepseek-chat \
    members add { ${BACKEND_NODE}:8005 { address ${BACKEND_ADDR} } } || true

tmsh create ltm pool /Common/pool_claude-3-opus \
    members add { ${BACKEND_NODE}:8006 { address ${BACKEND_ADDR} } } || true

tmsh create ltm pool /Common/pool_llm_default \
    members add { ${BACKEND_NODE}:irdmi { address ${BACKEND_ADDR} } } || true

tmsh create ltm pool /Common/pool_llama \
    members add { ${BACKEND_NODE}:8012 { address ${BACKEND_ADDR} } } || true

echo "    Pools created."

# ---------------------------------------------------------------------------
# Step 2: Create the Data Group (model → fully-qualified pool path)
#
# Key   = exact model name as sent in the API request JSON body
# Value = fully-qualified LTM pool path (required by ILXLbOptions.pool)
#
# Special keys:
#   __default__  = fallback pool when model is not found in the DG
#
# To add a new model AFTER deployment (zero-downtime, no plugin reload):
#   tmsh modify ltm data-group internal llm_model_pool_map \
#       records add { "o1-mini" { data "/Common/pool_openai_o1" } }
# ---------------------------------------------------------------------------
echo "==> Step 2: Creating Data Group '${DG_NAME}'..."

tmsh create ltm data-group internal ${DG_NAME} type string records add { "gpt-4o" { data "/Common/pool_gpt-4o" } "gpt-4o-mini" { data "/Common/pool_gpt-4o-mini" } "gpt-4o-2024-11-20" { data "/Common/pool_gpt-4o" } "gpt-4o-2024-08-06" { data "/Common/pool_gpt-4o" } "gpt-3.5-turbo" { data "/Common/pool_gpt-3.5-turbo" } "gpt-3.5-turbo-0125" { data "/Common/pool_gpt-3.5-turbo" } "claude-3-opus-20240229" { data "/Common/pool_claude-3-opus" } "gemini-1.5-pro" { data "/Common/pool_gemini-1.5-pro" } "gemini-1.5-pro-latest" { data "/Common/pool_gemini-1.5-pro" } "gemini-1.5-flash" { data "/Common/pool_gemini-1.5-pro" } "deepseek-chat" { data "/Common/pool_deepseek-chat" } "deepseek-reasoner" { data "/Common/pool_deepseek-chat" } "Llama-3.2-1B-Instruct" { data "/Common/pool_llama,llama3.2" } "__default__" { data "/Common/pool_llm_default" } }

echo "    Data Group created with $(tmsh list ltm data-group internal ${DG_NAME} | grep -c '{') records."

# ---------------------------------------------------------------------------
# Step 3: Upload iRuleLX Workspace archive and create Plugin
#
# The archive must contain:
#   llm_router_ext/
#   llm_router_ext/index.js
#   llm_router_ext/package.json
#   llm_router_ext/node_modules/   (after npm install)
#
# Build the archive on a workstation (or BIG-IP bash):
#   cd /path/to/llm_router/extensions
#   npm install --prefix llm_router_ext
#   tar czf /tmp/llm_router_ext.tgz llm_router_ext/
#   scp /tmp/llm_router_ext.tgz root@<bigip_mgmt_ip>:/tmp/
# ---------------------------------------------------------------------------
echo "==> Step 3: Creating iRuleLX Plugin '${PLUGIN_NAME}'..."

# Create plugin from the uploaded tgz archive.
# The 'extensions' block names must match the top-level directory in the tgz.
tmsh create ilx plugin ${PLUGIN_NAME} \
    from-local-file ${WORKSPACE_ARCHIVE} \
    extensions { ${EXT_NAME} { } }

echo "    Plugin '${PLUGIN_NAME}' created."

# ---------------------------------------------------------------------------
# Step 4: Associate the Data Group with the Plugin
#
# This is what makes plugin.getDataGroup('/Common/llm_model_pool_map') work
# and enables automatic live-sync when the DG is modified.
# ---------------------------------------------------------------------------
echo "==> Step 4: Associating Data Group with Plugin..."

tmsh modify ilx plugin ${PLUGIN_NAME} \
    datagroup-reference { ${DG_NAME} { } }

echo "    Data Group '${DG_NAME}' associated with plugin '${PLUGIN_NAME}'."

# ---------------------------------------------------------------------------
# Step 5: Create ILX Profile
# The ILX profile binds the plugin to Virtual Servers.
# ---------------------------------------------------------------------------
echo "==> Step 5: Creating ILX Profile '${ILX_PROFILE_NAME}'..."

tmsh create ltm profile ilx ${ILX_PROFILE_NAME} \
    plugin ${PLUGIN_NAME}

echo "    ILX Profile created."

# ---------------------------------------------------------------------------
# Step 6: Create Virtual Server
#
# CRITICAL requirements for the iRuleLX Streaming HTTP mode:
#   1. An HTTP profile MUST be present (enables requestStart/requestComplete)
#   2. The ILX profile MUST be present (attaches the plugin)
#   3. No default pool is set here — pool selection is 100% driven by
#      the plugin via flow.lbSelect(). A pool can optionally be set as
#      a safety net for connections that bypass the plugin.
# ---------------------------------------------------------------------------
echo "==> Step 6: Creating Virtual Server '${VS_NAME}'..."

# Build optional SSL profile arguments. Note currently does not use ssl profile for now
SSL_PROFILES=""
if [[ -n "${SSL_CLIENT_PROFILE}" ]]; then
    SSL_PROFILES="${SSL_PROFILES} profiles add { ${SSL_CLIENT_PROFILE} { context clientside } }"
fi
if [[ -n "${SSL_SERVER_PROFILE}" ]]; then
    SSL_PROFILES="${SSL_PROFILES} profiles add { ${SSL_SERVER_PROFILE} { context serverside } }"
fi

tmsh create ltm virtual ${VS_NAME} \
    destination ${VS_IP}:${VS_PORT} \
    ip-protocol tcp \
    profiles add {
        ${HTTP_PROFILE} { context clientside }
        ${ILX_PROFILE_NAME} { }
    } \
    pool /Common/pool_llm_default \
    source-address-translation { type automap }

echo "    Virtual Server '${VS_NAME}' created."

# ---------------------------------------------------------------------------
# Step 7: Save config and verify
# ---------------------------------------------------------------------------
echo "==> Step 7: Saving configuration..."
tmsh save sys config

echo ""
echo "==> Verification:"
echo "--- ILX Plugin ---"
tmsh list ilx plugin ${PLUGIN_NAME}
echo ""
echo "--- Data Group (first 5 records) ---"
tmsh list ltm data-group internal ${DG_NAME} | head -20
echo ""
echo "--- ILX Profile ---"
tmsh list ltm profile ilx ${ILX_PROFILE_NAME}
echo ""
echo "--- Virtual Server ---"
tmsh list ltm virtual ${VS_NAME}

echo ""
echo "============================================================"
echo " Deployment complete."
echo " Plugin logs: tail -f /var/log/ltm | grep llm_router"
echo ""
echo " To add a new model route (zero downtime):"
echo "   tmsh modify ltm data-group internal ${DG_NAME} \\"
echo "       records add { \"o1-mini\" { data \"/Common/pool_openai_o1\" } }"
echo ""
echo " To remove a model route:"
echo "   tmsh modify ltm data-group internal ${DG_NAME} \\"
echo "       records delete { \"gpt-3.5-turbo\" }"
echo "============================================================"
