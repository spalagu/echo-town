#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
target_dir="$repo_root/target/wasm32-unknown-unknown/release"
output_dir="$repo_root/crates/world-core/pkg"

cargo build --manifest-path "$repo_root/Cargo.toml" --package echo-town-world-core --target wasm32-unknown-unknown --release
mkdir -p "$output_dir"
wasm-bindgen "$target_dir/echo_town_world_core.wasm" --target web --out-dir "$output_dir" --out-name echo_town_world_core
echo "World Core Wasm 构建完成：$output_dir"
