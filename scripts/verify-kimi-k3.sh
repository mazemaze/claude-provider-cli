#!/usr/bin/env bash
# Verifies the built-in kimi provider points at Kimi K3 and that its declared
# context window does not leak into other providers.
# Offline: uses a throwaway config home and never needs the Keychain or network.
set -euo pipefail

cd "$(dirname "$0")/.."

TMP_HOME="$(mktemp -d)"
trap 'rm -rf "$TMP_HOME"' EXIT
export CLAUDE_PROVIDER_HOME="$TMP_HOME"

fail() { echo "FAIL: $1" >&2; exit 1; }

LIST="$(node bin/claude-provider.js list)"
echo "$LIST" | grep -q "name: Kimi K3"  || fail "kimi is not presented as Kimi K3"
echo "$LIST" | grep -q "model: k3"      || fail "kimi is not using model k3"

# The window must be cleared for providers that do not declare one, otherwise
# kimi's 1M window leaks into a default Sonnet session and compaction never runs.
node bin/claude-provider.js env default | grep -q "unset CLAUDE_CODE_MAX_CONTEXT_TOKENS" \
  || fail "CLAUDE_CODE_MAX_CONTEXT_TOKENS is not cleared for the default provider"

# Docs and --help must name the model users are actually getting.
node bin/claude-provider.js --help | grep -q "kimi .*k3" \
  || fail "--help does not describe kimi as using k3"
grep -q '`kimi`: .*`k3`' README.md \
  || fail "README does not describe the kimi provider as using k3"

node test/smoke.test.js >/dev/null || fail "smoke tests failed"

echo "PASS: kimi -> Kimi K3 (k3), context window isolated, smoke tests green"
