# F5 LLM Observability Adapter — runtime image (linux/amd64)
# Build context: this directory (adapter_service/)
# Only runtime code is copied; see .dockerignore

FROM python:3.12-slim-bookworm

# Optional build-time proxy / PyPI mirror (do not leave these set at runtime)
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG http_proxy
ARG https_proxy
ARG NO_PROXY
ARG no_proxy
ARG PIP_INDEX_URL
ARG PIP_TRUSTED_HOST

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    ADAPTER_PRICING_RULES_PATH=/app/pricing_rules.json \
    PORT=8090

WORKDIR /app

RUN groupadd --system --gid 10001 adapter \
    && useradd --system --uid 10001 --gid adapter --home-dir /app --shell /usr/sbin/nologin adapter

COPY requirements.txt .

# Proxy / index only for this layer; cleared afterwards so the image has no baked-in proxy.
RUN export HTTP_PROXY="${HTTP_PROXY}" HTTPS_PROXY="${HTTPS_PROXY}" \
        http_proxy="${http_proxy:-$HTTP_PROXY}" https_proxy="${https_proxy:-$HTTPS_PROXY}" \
        NO_PROXY="${NO_PROXY}" no_proxy="${no_proxy:-$NO_PROXY}" \
    && if [ -n "${PIP_INDEX_URL}" ]; then \
         pip install --no-cache-dir \
           -i "${PIP_INDEX_URL}" \
           ${PIP_TRUSTED_HOST:+--trusted-host "${PIP_TRUSTED_HOST}"} \
           -r requirements.txt; \
       else \
         pip install --no-cache-dir -r requirements.txt; \
       fi

COPY main.py mcp_events.py mcp_metrics.py pricing_rules.json ./

RUN chown -R adapter:adapter /app
USER adapter

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/health', timeout=3)"

# --no-access-log: Prometheus scrapes /metrics often; avoid filling docker json logs.
# App / debug prints still go to stdout/stderr (rotate via docker --log-opt / compose logging).
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8090} --no-access-log"]
