#!/bin/bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
runtime="$root/packages/app-expo/modules/readany-mlx-embedding/runtime"
destination="$root/packages/app/src-tauri/target/mlx-sidecar"
derived_data="${READANY_MLX_DERIVED_DATA:-${TMPDIR:-/tmp}/readany-mlx-macos-swift}"

cd "$runtime"
xcodebuild -scheme Qwen3Sidecar -configuration Release \
  -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath "$derived_data" -onlyUsePackageVersionsFromResolvedFile build

products="$derived_data/Build/Products/Release"
mkdir -p "$destination"
install -m 755 "$products/Qwen3Sidecar" "$destination/Qwen3Sidecar"
ditto "$products/mlx-swift_Cmlx.bundle" "$destination/mlx-swift_Cmlx.bundle"
test -s "$destination/mlx-swift_Cmlx.bundle/Contents/Resources/default.metallib"
