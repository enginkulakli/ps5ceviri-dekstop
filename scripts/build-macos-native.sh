#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
  echo "The Chiaki helper must be built on an Apple Silicon Mac." >&2
  exit 1
fi

export MACOSX_DEPLOYMENT_TARGET=15.0
root="$(pwd -P)"
libraries=(openssl@3 libevent json-c miniupnpc)
prefixes=()
for library in "${libraries[@]}"; do
  prefixes+=("$(brew --prefix "$library")")
done
prefix_path="$(IFS=';'; printf '%s' "${prefixes[*]}")"
pkg_paths=()
for prefix in "${prefixes[@]}"; do
  pkg_paths+=("$prefix/lib/pkgconfig")
done
export PKG_CONFIG_PATH="$(IFS=':'; printf '%s' "${pkg_paths[*]}")"

bash scripts/checkout-chiaki.sh "$root/.native-deps/chiaki"
cmake -S native -B native-build -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.10 \
  -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_OSX_DEPLOYMENT_TARGET="$MACOSX_DEPLOYMENT_TARGET" \
  -DCMAKE_EXE_LINKER_FLAGS="-Wl,-headerpad_max_install_names" \
  -DCHIAKI_SOURCE="$root/.native-deps/chiaki" \
  -DCMAKE_PREFIX_PATH="$prefix_path" -DOPENSSL_ROOT_DIR="${prefixes[0]}" \
  -DCURL_USE_OPENSSL=ON -DCURL_USE_LIBPSL=OFF -DUSE_LIBIDN2=OFF \
  -DCURL_BROTLI=OFF -DCURL_ZSTD=OFF
cmake --build native-build --target ps5-remote
cmake --install native-build --prefix "$root/native-bin"
python3 scripts/stage-macos-libraries.py "$root/native-bin/ps5-remote" "${prefixes[@]}"
brew list --versions "${libraries[@]}" > "$root/native-bin/homebrew-build-dependencies.txt"
lipo -verify_arch arm64 "$root/native-bin/ps5-remote"
"$root/native-bin/ps5-remote" --self-test
