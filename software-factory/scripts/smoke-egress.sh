#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FACTORY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${FACTORY_DIR}"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker CLI not found. Enable Docker Engine / Docker Desktop WSL integration to run live Compose smoke tests." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: docker compose plugin not available." >&2
  exit 1
fi

if [ -f "${FACTORY_DIR}/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "${FACTORY_DIR}/.env"
  set +a
fi

export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-smoke-postgres-password}"
export GITHUB_WEBHOOK_SECRET="${GITHUB_WEBHOOK_SECRET:-smoke-webhook-secret}"

SANDBOX_SMOKE_IMAGE="${SANDBOX_SMOKE_IMAGE:-curlimages/curl:8.12.1}"
PROXY_URL="http://egress-proxy:3128"

cleanup() {
  if [ "${SMOKE_CLEANUP:-false}" = "true" ]; then
    echo "Tearing down Compose stack (SMOKE_CLEANUP=true)..."
    docker compose down -v
  fi
}
trap cleanup EXIT

assert_service_healthy() {
  local service="$1"
  local container_id
  container_id="$(docker compose ps -q "${service}")"
  if [ -z "${container_id}" ]; then
    echo "FAIL: service '${service}' has no running container" >&2
    exit 1
  fi
  local status
  status="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}")"
  if [ "${status}" != "healthy" ]; then
    echo "FAIL: service '${service}' status is '${status}', expected 'healthy'" >&2
    docker compose logs --tail=50 "${service}" >&2 || true
    exit 1
  fi
  echo "OK: service '${service}' is healthy"
}

run_sandbox_curl() {
  docker run --rm \
    --network "${SANDBOX_NETWORK}" \
    -e "HTTP_PROXY=${PROXY_URL}" \
    -e "HTTPS_PROXY=${PROXY_URL}" \
    -e "NO_PROXY=localhost,127.0.0.1" \
    "${SANDBOX_SMOKE_IMAGE}" \
    "$@"
}

assert_direct_blocked() {
  local url="$1"
  if run_sandbox_curl --noproxy '*' -fsS --max-time 5 "${url}" >/dev/null 2>&1; then
    echo "FAIL: direct non-proxied request to ${url} unexpectedly succeeded" >&2
    exit 1
  fi
  echo "OK: direct non-proxied request to ${url} blocked"
}

assert_http_proxy_blocked() {
  local url="$1"
  local status_code
  status_code="$(run_sandbox_curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "${url}" || true)"
  if [ "${status_code}" != "403" ]; then
    echo "FAIL: proxied HTTP request to ${url} returned '${status_code}', expected 403" >&2
    exit 1
  fi
  echo "OK: proxied HTTP request to ${url} rejected with 403"
}

assert_https_connect_blocked() {
  local url="$1"
  local connect_code
  connect_code="$(run_sandbox_curl -sS -o /dev/null -w '%{http_connect}' --max-time 10 "${url}" || true)"
  if [ "${connect_code}" != "403" ]; then
    echo "FAIL: proxied HTTPS CONNECT to ${url} returned '${connect_code}', expected 403" >&2
    exit 1
  fi
  echo "OK: proxied HTTPS CONNECT to ${url} rejected with 403"
}

assert_https_connect_allowed() {
  local url="$1"
  local expected_http_code="${2:-}"
  local output
  output="$(run_sandbox_curl -sS -o /dev/null -w '%{http_connect} %{http_code}' --max-time 15 "${url}")"
  local connect_code
  local http_code
  connect_code="$(printf '%s' "${output}" | awk '{print $1}')"
  http_code="$(printf '%s' "${output}" | awk '{print $2}')"

  if [ "${connect_code}" != "200" ]; then
    echo "FAIL: allowlisted HTTPS CONNECT to ${url} returned connect=${connect_code} http=${http_code}" >&2
    exit 1
  fi
  if [ -n "${expected_http_code}" ] && [ "${http_code}" != "${expected_http_code}" ]; then
    echo "FAIL: allowlisted HTTPS request to ${url} returned HTTP ${http_code}, expected ${expected_http_code}" >&2
    exit 1
  fi
  echo "OK: allowlisted HTTPS request to ${url} succeeded (connect=${connect_code}, http=${http_code})"
}

echo "Starting software-factory stack with egress-proxy..."
docker compose up -d --build --wait

for service in postgres hatchet-lite egress-proxy; do
  assert_service_healthy "${service}"
done

PROXY_CONTAINER_ID="$(docker compose ps -q egress-proxy)"
HATCHET_CONTAINER_ID="$(docker compose ps -q hatchet-lite)"

SANDBOX_NETWORK="$(docker inspect --format='{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "${PROXY_CONTAINER_ID}" | grep 'sandbox-isolated' | head -n 1)"
CONTROL_PLANE_NETWORK="$(docker inspect --format='{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "${HATCHET_CONTAINER_ID}" | grep 'control-plane' | head -n 1)"

if [ -z "${SANDBOX_NETWORK}" ]; then
  echo "FAIL: could not locate sandbox-isolated network on egress-proxy" >&2
  exit 1
fi

IS_INTERNAL="$(docker network inspect --format='{{.Internal}}' "${SANDBOX_NETWORK}")"
if [ "${IS_INTERNAL}" != "true" ]; then
  echo "FAIL: network '${SANDBOX_NETWORK}' Internal=${IS_INTERNAL}, expected true" >&2
  exit 1
fi
echo "OK: network '${SANDBOX_NETWORK}' is internal: true"

if docker inspect --format='{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "${PROXY_CONTAINER_ID}" | grep -qx "${CONTROL_PLANE_NETWORK}"; then
  echo "FAIL: egress-proxy is attached to control-plane network '${CONTROL_PLANE_NETWORK}'" >&2
  exit 1
fi
echo "OK: egress-proxy is NOT attached to control-plane network '${CONTROL_PLANE_NETWORK}'"

assert_direct_blocked "https://registry.npmjs.org/-/ping"
assert_direct_blocked "http://hatchet-lite:8888/"
assert_direct_blocked "http://postgres:5432/"

assert_https_connect_allowed "https://registry.npmjs.org/-/ping" "200"
assert_https_connect_allowed "https://api.anthropic.com/"

assert_http_proxy_blocked "http://example.com/"
assert_https_connect_blocked "https://example.com/"

for private_target in \
  "http://192.168.1.1/" \
  "http://10.0.0.1/" \
  "http://172.16.0.1/" \
  "http://100.64.0.1/" \
  "http://169.254.169.254/latest/meta-data/"; do
  assert_http_proxy_blocked "${private_target}"
done

for internal_target in \
  "http://hatchet-lite:8888/" \
  "http://postgres:5432/" \
  "http://webhook-gateway:3000/healthz" \
  "http://phoenix:6006/healthz"; do
  assert_http_proxy_blocked "${internal_target}"
done

echo "PASS: Isolated sandbox network and egress allowlist proxy smoke test succeeded"
