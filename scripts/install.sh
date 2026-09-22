#!/bin/sh
# Pixi installer: downloads the latest Pixi release binary from GitHub.
#   curl -fsSL https://raw.githubusercontent.com/Panoplos/Pixi/main/scripts/install.sh | sh
set -eu

REPO="Panoplos/Pixi"
INSTALL_DIR="${PIXI_INSTALL_DIR:-$HOME/.local/bin}"

oops() { echo "error: $1" >&2; exit 1; }

# --- platform detection -----------------------------------------------------
uname_s=$(uname -s)
uname_m=$(uname -m)
case "$uname_s" in
Darwin) os=darwin ;;
Linux) os=linux ;;
*) oops "unsupported operating system: $uname_s (use npm install or build from source, see the README)" ;;
esac
case "$uname_m" in
arm64 | aarch64) arch=arm64 ;;
x86_64) arch=x64 ;;
*) oops "unsupported architecture: $uname_m" ;;
esac
platform="$os-$arch"

# --- latest release ---------------------------------------------------------
echo "==> Looking up the latest Pixi release..."
if command -v curl >/dev/null 2>&1; then
    fetch() { curl -fsSL "$1"; }
elif command -v wget >/dev/null 2>&1; then
    fetch() { wget -qO- "$1"; }
else
    oops "need curl or wget to download Pixi"
fi

tag=$(fetch "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p')
if [ -z "$tag" ]; then
    oops "no published release found at github.com/$REPO yet - build from source instead (see the README)"
fi

# --- download & unpack ------------------------------------------------------
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
asset="pixi-$platform.tar.gz"
url="https://github.com/$REPO/releases/download/$tag/$asset"
echo "==> Downloading $asset from $tag..."
mkdir -p "$tmp/extracted"
fetch "$url" | tar -xzf - -C "$tmp/extracted"

binary="$tmp/extracted/pixi/pixi"
[ -f "$binary" ] || oops "archive did not contain the expected pixi binary"

# --- install ----------------------------------------------------------------
mkdir -p "$INSTALL_DIR"
mv "$binary" "$INSTALL_DIR/pixi"
chmod +x "$INSTALL_DIR/pixi"
echo "==> Installed $INSTALL_DIR/pixi ($(basename "$tag"))"

case ":$PATH:" in
*":$INSTALL_DIR:"*) ;;
*)
    echo "==> Note: $INSTALL_DIR is not on your PATH. Add this to your shell profile:"
    echo "    export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac
"$INSTALL_DIR/pixi" --version || true
