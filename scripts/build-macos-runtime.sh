#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
  echo "The macOS runtime must be built on an Apple Silicon Mac." >&2
  exit 1
fi

export MACOSX_DEPLOYMENT_TARGET=15.0
root="$(pwd -P)"
deps="$root/.native-deps"
runtime="$root/runtime-bin"
mkdir -p "$deps" "$runtime"

curl -fLsS --retry 3 https://github.com/JetBrains/kotlin/releases/download/v2.2.21/kotlin-compiler-2.2.21.zip -o "$deps/kotlin.zip"
unzip -qo "$deps/kotlin.zip" -d "$deps"
bash scripts/build-v3-runtime.sh "$deps/kotlinc/lib" "$runtime"
jlink --add-modules java.base,java.logging,java.xml --no-header-files --no-man-pages --strip-debug --compress=2 --output "$runtime/jre"
"$runtime/jre/bin/java" -version

archive="$deps/ffmpeg-9.1.tar.xz"
curl -fLsS --retry 3 https://ffmpeg.org/releases/ffmpeg-9.1.tar.xz -o "$archive"
printf '%s  %s\n' '1a4d394ae63d190a526cd052eb4415c156b5c5e2df37efab41a7de0b8fde2433' "$archive" | shasum -a 256 -c -
tar -xJf "$archive" -C "$deps"

# Keep distribution self-contained. Only the codecs and filters used by the
# common H.264 -> monochrome frame pipeline are enabled in this build.
(
  cd "$deps/ffmpeg-9.1"
  ./configure --disable-everything --disable-autodetect --disable-doc --disable-debug \
    --disable-ffplay --disable-ffprobe --disable-network --disable-shared --enable-static \
    --enable-ffmpeg --enable-avfilter --enable-swscale \
    --enable-demuxer=h264 --enable-parser=h264 --enable-decoder=h264 \
    --enable-encoder=rawvideo --enable-muxer=rawvideo --enable-protocol=pipe,file \
    --enable-filter=select,scale,format --extra-cflags="-mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET" \
    --extra-ldflags="-mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET"
  make -j"$(sysctl -n hw.logicalcpu)" ffmpeg
  cp ffmpeg "$runtime/"
  cp COPYING.LGPLv2.1 "$runtime/FFmpeg-LICENSE.txt"
)
"$runtime/ffmpeg" -version
lipo "$runtime/ffmpeg" -verify_arch arm64
lipo "$runtime/jre/bin/java" -verify_arch arm64
