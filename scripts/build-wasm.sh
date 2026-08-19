#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/wasm"

wasm-pack build --target web --release --out-dir ../src/wasm-pkg --out-name space_invaders

echo "WASM build complete -> src/wasm-pkg/"