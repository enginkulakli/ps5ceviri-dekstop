#!/usr/bin/env bash
set -euo pipefail

bash scripts/checkout-chiaki.sh .native-deps/chiaki
cmake -S native -B native-build -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.10 \
  -DCHIAKI_SOURCE="$(cygpath -am .native-deps/chiaki)"
cmake --build native-build --target ps5-remote
cmake --install native-build --prefix "$(cygpath -am native-bin)"
ldd native-bin/ps5-remote.exe | awk '/=> \/mingw64\// { print $3 }' |
  sort -u | while IFS= read -r dll; do cp -v "$dll" native-bin/; done
PATH="$(pwd)/native-bin:/usr/bin" ./native-bin/ps5-remote.exe --self-test
