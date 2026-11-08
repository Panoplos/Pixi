#!/bin/bash
# Drives the RPC demo: pixi in the top pane, pixi-rpc send in the bottom pane.
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/env.sh"
T() { tmux -S "$TMUX_SOCK" "$@"; }

rm -rf "$RPC_DIR"
mkdir -p "$RPC_DIR" "$AGENT_DIR/rpc"
cd "$RPC_DIR"

T kill-server 2>/dev/null || true
rm -f "$TMUX_SOCK"
rm -rf "$AGENT_DIR/rpc"
mkdir -p "$AGENT_DIR/rpc"
marker=$DEMO_ROOT/start.stamp
touch "$marker"

T -f "$TMUX_CONF" new-session -d -s demo -x 112 -y 18 -c "$RPC_DIR"
T split-window -v -l 5 -t demo:0.0 -c "$RPC_DIR" "PROMPT='\$ ' zsh -f -i"
T send-keys -t demo:0.0 "pixi" Enter

(
	# wait for the session's RPC socket to appear
	sock=""
	for _ in $(seq 1 300); do
		candidate=$(find "$AGENT_DIR/rpc" -name '*.sock' -newer "$marker" 2>/dev/null | head -1)
		if [ -n "$candidate" ]; then
			sock=$candidate
			break
		fi
		sleep 0.2
	done
	[ -n "$sock" ] || exit 1
	id=$(basename "$sock" .sock)
	sleep 3

	cmd="pixi-rpc send --session-id $id \"17 x 23? Just the number.\""
	for ((i = 0; i < ${#cmd}; i++)); do
		T send-keys -l -t demo:0.1 "${cmd:$i:1}"
		sleep 0.018
	done
	sleep 0.4
	T send-keys -t demo:0.1 Enter

	# wait until the send returns to the prompt, then hold for the viewer
	for _ in $(seq 1 600); do
		if T capture-pane -pt demo:0.1 | tail -2 | grep -q '^$ '; then
			break
		fi
		sleep 0.3
	done
	sleep 3
	T kill-server
	rm -rf "$RPC_DIR"
) &

T attach -t demo
