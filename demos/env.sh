# Shared paths for the demo recordings. Source from the repo root.
DEMOS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "$DEMOS_DIR/.." && pwd)
DEMO_ROOT=${DEMO_ROOT:-/tmp/pixi-demos}

AGENT_DIR=$DEMO_ROOT/agent
PREFIX_DIR=$DEMO_ROOT/prefix
RPC_DIR=$DEMO_ROOT/rpc
MASK_DIR=$DEMO_ROOT/mask
TMUX_CONF=$DEMOS_DIR/tmux.conf
TMUX_SOCK=$DEMO_ROOT/tmux.sock

# Run the pixi from ~/.local/bin and keep the throwaway home out of ~/.pi.
export PI_CODING_AGENT_DIR=$AGENT_DIR
export PATH=$HOME/.local/bin:$PATH
