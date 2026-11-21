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
export WEBHOOK_PORT="${WEBHOOK_PORT:-3000}"

GATEWAY_URL="http://127.0.0.1:${WEBHOOK_PORT}"
DELIVERY_ID="smoke-skeleton-$(date +%s)-$$"

cleanup() {
  if [ "${SMOKE_CLEANUP:-false}" = "true" ]; then
    echo "Tearing down Compose stack (SMOKE_CLEANUP=true)..."
    docker compose down -v
  fi
}
trap cleanup EXIT

compute_signature() {
  local payload="$1"
  local digest
  digest="$(printf '%s' "${payload}" | openssl dgst -sha256 -hmac "${GITHUB_WEBHOOK_SECRET}" | awk '{print $NF}')"
  printf 'sha256=%s' "${digest}"
}

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

echo "Starting software-factory Compose skeleton..."
docker compose up -d --build --wait

for service in postgres hatchet-lite webhook-gateway factory-worker; do
  assert_service_healthy "${service}"
done

echo "Checking Webhook Gateway /healthz..."
health_status="$(curl -sS -o /dev/null -w '%{http_code}' "${GATEWAY_URL}/healthz")"
if [ "${health_status}" != "200" ]; then
  echo "FAIL: /healthz returned HTTP ${health_status}" >&2
  exit 1
fi
echo "OK: /healthz returned 200"

echo "Checking unsigned webhook rejection (expected 401)..."
unauth_status="$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: issues" \
  -H "X-GitHub-Delivery: ${DELIVERY_ID}-unauth" \
  -d '{"action":"labeled"}' \
  "${GATEWAY_URL}/webhooks/github")"
if [ "${unauth_status}" != "401" ]; then
  echo "FAIL: unsigned webhook returned HTTP ${unauth_status}, expected 401" >&2
  exit 1
fi
echo "OK: unsigned webhook rejected with 401"

echo "Checking validly signed unsupported event (expected 200 ignored)..."
ping_payload='{"zen":"Keep it logically awesome."}'
ping_sig="$(compute_signature "${ping_payload}")"
ping_response="$(curl -sS -w '\n%{http_code}' -X POST \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: ping" \
  -H "X-GitHub-Delivery: ${DELIVERY_ID}-ping" \
  -H "X-Hub-Signature-256: ${ping_sig}" \
  -d "${ping_payload}" \
  "${GATEWAY_URL}/webhooks/github")"
ping_status="$(printf '%s' "${ping_response}" | tail -n 1)"
if [ "${ping_status}" != "200" ]; then
  echo "FAIL: signed ping returned HTTP ${ping_status}, expected 200" >&2
  exit 1
fi
echo "OK: signed ping ignored cleanly with 200"

echo "Dispatching signed supported issues labeled event (delivery=${DELIVERY_ID})..."
issue_payload='{
  "action": "labeled",
  "label": { "name": "agent:implement" },
  "issue": { "number": 28, "title": "Walking skeleton smoke test" },
  "repository": {
    "full_name": "mdelucasg/software-factories",
    "name": "software-factories",
    "owner": { "login": "mdelucasg" },
    "clone_url": "https://github.com/mdelucasg/software-factories.git",
    "default_branch": "main"
  }
}'
issue_sig="$(compute_signature "${issue_payload}")"
dispatch_response="$(curl -sS -w '\n%{http_code}' -X POST \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: issues" \
  -H "X-GitHub-Delivery: ${DELIVERY_ID}" \
  -H "X-Hub-Signature-256: ${issue_sig}" \
  -d "${issue_payload}" \
  "${GATEWAY_URL}/webhooks/github")"
dispatch_status="$(printf '%s' "${dispatch_response}" | tail -n 1)"
dispatch_body="$(printf '%s' "${dispatch_response}" | sed '$d')"

if [ "${dispatch_status}" != "202" ]; then
  echo "FAIL: signed issues webhook returned HTTP ${dispatch_status}: ${dispatch_body}" >&2
  exit 1
fi
echo "OK: webhook dispatched (202): ${dispatch_body}"

echo "Waiting for factory-worker stub execution for delivery ${DELIVERY_ID}..."
executed="false"
for _attempt in $(seq 1 30); do
  if docker compose logs --no-color factory-worker | grep -q "${DELIVERY_ID}"; then
    executed="true"
    break
  fi
  sleep 1
done

if [ "${executed}" != "true" ]; then
  echo "FAIL: factory-worker did not log stub execution for ${DELIVERY_ID} within 30s" >&2
  docker compose logs --tail=80 factory-worker >&2 || true
  exit 1
fi

echo "PASS: Walking skeleton smoke test succeeded (delivery=${DELIVERY_ID})"
