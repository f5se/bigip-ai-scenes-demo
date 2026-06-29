from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LLM_DEMO_")

    default_vs_host: str = "172.16.30.122"
    default_vs_port: int = 8000
    connect_timeout: float = 5.0
    read_timeout: float = 30.0
    demo_interval_ms: int = 500
    tblb_scheduler_host: str = "127.0.0.1"
    tblb_scheduler_port: int = 8181
    tblb_demo_interval_ms: int = 50
    tblb_trigger_path: str = "/trigger_update"
    tblb_trigger_wait_sec: int = 10
    grafana_url: str = "http://localhost:3001"
    grafana_username: str = ""
    grafana_password: str = ""
    grafana_verify_tls: bool = True
    f5_mgmt_host: str = "172.16.20.198"
    f5_mgmt_username: str = "admin"
    f5_mgmt_password: str = "CHANGE_ME"
    f5_mgmt_partition: str = "Common"
    f5_mgmt_verify_tls: bool = False
    allowed_private_networks: tuple[str, ...] = (
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "127.0.0.0/8",
    )


settings = Settings()

# model name -> pool path (aligned with deploy.sh Data Group llm_model_pool_map)
MODEL_POOL_MAP: dict[str, str] = {
    "gpt-4o": "/Common/pool_gpt-4o",
    "gpt-4o-mini": "/Common/pool_gpt-4o-mini",
    "gpt-4o-2024-11-20": "/Common/pool_gpt-4o",
    "gpt-4o-2024-08-06": "/Common/pool_gpt-4o",
    "gpt-3.5-turbo": "/Common/pool_gpt-3.5-turbo",
    "gpt-3.5-turbo-0125": "/Common/pool_gpt-3.5-turbo",
    "claude-3-opus-20240229": "/Common/pool_claude-3-opus",
    "gemini-1.5-pro": "/Common/pool_gemini-1.5-pro",
    "gemini-1.5-pro-latest": "/Common/pool_gemini-1.5-pro",
    "gemini-1.5-flash": "/Common/pool_gemini-1.5-pro",
    "deepseek-chat": "/Common/pool_deepseek-chat",
    "deepseek-reasoner": "/Common/pool_deepseek-chat",
    "Llama-3.2-1B-Instruct": "/Common/pool_llama",
    "__default__": "/Common/pool_llm_default",
}

DG_MODEL_ORDER: list[str] = [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4o-2024-11-20",
    "gpt-4o-2024-08-06",
    "gpt-3.5-turbo",
    "gpt-3.5-turbo-0125",
    "claude-3-opus-20240229",
    "gemini-1.5-pro",
    "gemini-1.5-pro-latest",
    "gemini-1.5-flash",
    "deepseek-chat",
    "deepseek-reasoner",
    "Llama-3.2-1B-Instruct",
]

MODEL_OPTIONS: list[str] = list(DG_MODEL_ORDER)

INVALID_DEMO_MODEL = "deepseek-chat-xxx"


def case_id_for_model(model: str) -> str:
    return model.replace(".", "_").replace("-", "_")


def _build_routing_demo_cases() -> list[dict]:
    cases: list[dict] = []
    for model in DG_MODEL_ORDER:
        cases.append(
            {
                "case_id": case_id_for_model(model),
                "model": model,
                "label": model,
                "label_key": "",
                "expected_pool": MODEL_POOL_MAP[model],
                "expected_status": 200,
            }
        )
    cases.append(
        {
            "case_id": "invalid_model",
            "model": INVALID_DEMO_MODEL,
            "label": INVALID_DEMO_MODEL,
            "label_key": "cases.invalid",
            "expected_pool": MODEL_POOL_MAP["__default__"],
            "expected_status": 400,
        }
    )
    return cases


DEMO_CASES: list[dict] = _build_routing_demo_cases()


def resolve_expected_pool(model: str) -> str:
    return MODEL_POOL_MAP.get(model, MODEL_POOL_MAP["__default__"])


CONTEXT_SIZE_RULE: dict[str, object] = {
    "model": "deepseek-chat",
    "dg_value": (
        "/Common/pool_deepseek-chat,deepseek-chat,"
        "Size|5k|pool_deepseek_v4|deepseek-v4-flash"
    ),
    "threshold_k": 5,
    "threshold_bytes": 5 * 1024,
    "small_pool": "/Common/pool_deepseek-chat",
    "small_model": "deepseek-chat",
    "large_pool": "/Common/pool_deepseek_v4",
    "large_model": "deepseek-v4-flash",
}


AGENT_ROUTING: dict[str, object] = {
    "enterprise_model": "EnterpriseAgentModel",
    "identity_header": "x-Agent-Identity",
    "default_vs": {"host": "172.16.30.121", "port": 8000},
    "default_user_prompt": "开发一个面向儿童的贪吃蛇程序，并确保代码安全",
    "demo_interval_ms": 800,
    "agents": [
        {
            "id": "superviser",
            "label_key": "agentRouting.agents.superviser",
            "expected_pool": "/Common/pool_gpt-4o",
            "expected_model": "gpt-4o",
            "model_rewrite_expected": True,
        },
        {
            "id": "planner",
            "label_key": "agentRouting.agents.planner",
            "expected_pool": "/Common/pool_deepseek-chat",
            "expected_model": "deepseek-chat",
            "model_rewrite_expected": True,
        },
        {
            "id": "coder",
            "label_key": "agentRouting.agents.coder",
            "expected_pool": "/Common/pool_claude-3-opus",
            "expected_model": "claude-3-opus",
            "model_rewrite_expected": True,
        },
        {
            "id": "tester",
            "label_key": "agentRouting.agents.tester",
            "expected_pool": "/Common/pool_gemini-1.5-pro",
            "expected_model": "gemini-1.5-pro",
            "model_rewrite_expected": True,
        },
        {
            "id": "scanner",
            "label_key": "agentRouting.agents.scanner",
            "expected_pool": "/Common/pool_llama",
            "expected_model": "llama3.2",
            "model_rewrite_expected": True,
        },
    ],
}

TBLB_DEMO_POOLS: list[dict[str, object]] = [
    {
        "pool": "/Common/pool_gpt-4o",
        "pool_short": "pool_gpt-4o",
        "tblb_enabled": True,
        "models": [
            "gpt-4o",
            "gpt-4o-2024-11-20",
            "gpt-4o-2024-08-06",
        ],
    },
    {
        "pool": "/Common/pool_gemini-1.5-pro",
        "pool_short": "pool_gemini-1.5-pro",
        "tblb_enabled": True,
        "models": [
            "gemini-1.5-pro",
            "gemini-1.5-pro-latest",
            "gemini-1.5-flash",
        ],
    },
    {
        "pool": "/Common/pool_deepseek-chat",
        "pool_short": "pool_deepseek-chat",
        "tblb_enabled": False,
        "models": ["deepseek-chat", "deepseek-reasoner"],
    },
]

TBLB_DEMO_MODELS: list[str] = [
    model for group in TBLB_DEMO_POOLS for model in group["models"]  # type: ignore[misc]
]

TBLB_DEMO_DEFAULT_ITERATIONS: int = 500


RETRY_FALLBACK_RULE: dict[str, object] = {
    "retry_model": "testmodel",
    "retry_primary_pool": "/Common/pool_testmode",
    "retry_fallback_pool": "/Common/pool_llm_default",
    "retry_test_member": {"node": "ubuntu-ai", "port": 8008},
    "tcp_demo_models": ["deepseek-chat", "deepseek-reasoner"],
    "tcp_pool": "/Common/pool_deepseek-chat",
    "tcp_bad_member": {"node": "ubuntu-ai", "port": 7999},
    "tcp_good_member": {"node": "ubuntu-ai", "port": 8005},
    "default_member": {"node": "ubuntu-ai", "port": 8000},
}

SYSTEM_PROMPT: dict[str, object] = {
    "default_vs": {"host": "172.16.30.124", "port": 8000},
    "demo_model": "demo-model",
    "nonce": "F5",
    "mock_llm_port": 8011,
}

MODEL_ALLOWLIST_DEMO: dict[str, object] = {
    "default_vs": {"host": "172.16.30.124", "port": 8000},
    "datagroup": "dg_openai_model_list",
    "default_action": "block",
    "allowed_model": "demo-model",
    "allowed_models": ["demo-model", "gpt-5.2-codex", "gpt-5.3-codex"],
    "irule_layer": "iRule Layer 0",
    "vs_note": "Same VS as System prompt hardening (JSON Profile + ir_openai_api.tcl)",
    "records": [
        {"model": "demo-model", "action": "allow"},
        {"model": "gpt-5.2-codex", "action": "allow"},
        {"model": "gpt-5.3-codex", "action": "allow"},
    ],
}

MAX_TOKENS_DEMO: dict[str, object] = {
    "default_vs": {"host": "172.16.30.124", "port": 8000},
    "demo_model": "demo-model",
    "max_tokens_limit": 4096,
    "irule_layer": "iRule Layer 0",
    "vs_note": "Same VS as System prompt hardening (JSON Profile + ir_openai_api.tcl)",
    "presets": [
        {"id": "compliant", "max_tokens": 2048, "expected": "allow"},
        {"id": "overflow", "max_tokens": 8192, "expected": "block"},
    ],
}
