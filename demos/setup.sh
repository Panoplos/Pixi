#!/bin/bash
# Builds the throwaway pixi home and the fixtures the tapes record against.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
real_agent=${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}
source "$here/env.sh"

[ -f "$real_agent/auth.json" ] || {
	echo "no auth.json in $real_agent: run pixi and log in first" >&2
	exit 1
}

rm -rf "$DEMO_ROOT"
mkdir -p "$AGENT_DIR/extensions" "$AGENT_DIR/themes" "$PREFIX_DIR" "$RPC_DIR" "$MASK_DIR"

cp "$real_agent/auth.json" "$AGENT_DIR/auth.json"
cp "$here/settings.json" "$AGENT_DIR/settings.json"
cp "$ROOT_DIR/packages/coding-agent/examples/extensions/key-guard.ts" "$AGENT_DIR/extensions/"
[ -f "$real_agent/themes/lavender.json" ] && cp "$real_agent/themes/lavender.json" "$AGENT_DIR/themes/"

# Fabricated credentials with real-looking entropy, so the masking rules fire.
# openssl keeps them random per run; nothing here is a real key.
cat >"$MASK_DIR/fake.env" <<EOF
# demo credentials, all fabricated
OPENAI_API_KEY=sk-proj-$(openssl rand -hex 24)
GITHUB_TOKEN=ghp_$(openssl rand -hex 18)
EOF

cat >"$DEMO_ROOT/prefix.json" <<'EOF'
{
  "promptPrefix": "λ "
}
EOF

echo "demo home ready: $DEMO_ROOT"
