#!/bin/bash
# ==============================================================================
# gh-set-status.sh — Posts a commit status to GitHub via the API
#
# Usage:
#   ./scripts/gh-set-status.sh <state> <context> <description>
#
#   state:       pending | success | failure | error
#   context:     ci/local/build | ci/local/smoke | ci/local/unit-tests | ci/local/combined
#   description: Short human-readable description
#
# Reads:
#   - GITHUB_TOKEN from environment or ~/.hermes/github-hermes-token
#   - GIT SHA from the current repo HEAD
#   - GITHUB_REPO from GITHUB_REPO env or infers from git remote
#
# Environment overrides:
#   GITHUB_SHA     — explicit commit SHA (default: git rev-parse HEAD)
#   GITHUB_REPO    — "owner/repo" (default: inferred from git remote origin)
#   GITHUB_TOKEN   — GitHub PAT (default: read from ~/.hermes/github-hermes-token)
# ==============================================================================
set -euo pipefail

# ── Resolve inputs ─────────────────────────────────────────────────────────────
STATE="${1:-}"
CONTEXT="${2:-}"
DESCRIPTION="${3:-}"

if [ -z "$STATE" ] || [ -z "$CONTEXT" ]; then
  echo "Usage: $0 <state> <context> [description]"
  echo "  state: pending | success | failure | error"
  exit 1
fi

# Validate state
case "$STATE" in
  pending|success|failure|error) ;;
  *) echo "❌ Invalid state: $STATE (must be pending|success|failure|error)"; exit 1 ;;
esac

# ── Resolve GITHUB_TOKEN ───────────────────────────────────────────────────────
if [ -z "${GITHUB_TOKEN:-}" ]; then
  TOKEN_FILE="$HOME/.hermes/github-hermes-token"
  if [ -f "$TOKEN_FILE" ]; then
    GITHUB_TOKEN="$(grep -oP '(?<=^GITHUB_TOKEN=).*' "$TOKEN_FILE" 2>/dev/null || true)"
  fi
fi

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "❌ No GITHUB_TOKEN found (set env or ~/.hermes/github-hermes-token)"
  exit 1
fi

# ── Resolve repo ───────────────────────────────────────────────────────────────
if [ -z "${GITHUB_REPO:-}" ]; then
  REMOTE_URL="$(git config --get remote.origin.url 2>/dev/null || true)"
  if echo "$REMOTE_URL" | grep -qE '(github\.com[:/])([^/]+)/([^/]+?)(\.git)?$'; then
    GITHUB_REPO="$(echo "$REMOTE_URL" | sed -nE 's|.*github\.com[:/]([^/]+)/([^/]+?)(\.git)?$|\1/\2|p')"
  fi
fi

if [ -z "${GITHUB_REPO:-}" ]; then
  echo "❌ Could not determine repo (set GITHUB_REPO env or ensure git remote origin)"
  exit 1
fi

# ── Resolve SHA ────────────────────────────────────────────────────────────────
if [ -z "${GITHUB_SHA:-}" ]; then
  GITHUB_SHA="$(git rev-parse HEAD 2>/dev/null || true)"
fi

if [ -z "$GITHUB_SHA" ] || [ "$GITHUB_SHA" = "0000000000000000000000000000000000000000" ]; then
  echo "❌ Invalid SHA: $GITHUB_SHA"
  exit 1
fi

# ── Post status ────────────────────────────────────────────────────────────────
TARGET_URL="https://github.com/$GITHUB_REPO/commit/$GITHUB_SHA"

JSON_PAYLOAD=$(cat <<EOF
{
  "state": "$STATE",
  "target_url": "$TARGET_URL",
  "description": "$DESCRIPTION",
  "context": "$CONTEXT"
}
EOF
)

RESPONSE=$(curl -s -S -X POST \
  "https://api.github.com/repos/$GITHUB_REPO/statuses/$GITHUB_SHA" \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$JSON_PAYLOAD" 2>&1) || true

# Check if it worked
if echo "$RESPONSE" | grep -q '"id"'; then
  echo "✅ Status posted: $CONTEXT → $STATE"
else
  ERROR_MSG=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('message','unknown'))" 2>/dev/null || echo "$RESPONSE")
  echo "⚠️  Status post failed ($CONTEXT → $STATE): $ERROR_MSG"
fi
