#!/bin/bash
# Records every demo tape and installs the results in docs/images.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)

bash "$root/demos/setup.sh"
cd "$root"

for name in prefix rpc mask; do
	echo "== $name"
	(cd demos && vhs "$name.tape")
	case $name in
	prefix) target=prompt-prefix.gif ;;
	rpc) target=rpc-send.gif ;;
	mask) target=secret-masking.gif ;;
	esac
	cp "demos/$name.gif" "docs/images/$target"
	echo "docs/images/$target $(ls -l "demos/$name.gif" | awk '{print $5}') bytes"
done
