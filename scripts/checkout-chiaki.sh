#!/usr/bin/env bash
set -euo pipefail

source_dir="${1:?specify a checkout directory}"
commit=43728af2e639fecb8a7af1cd68c29820a40de973
if [ ! -d "$source_dir/.git" ]; then
  mkdir -p "$source_dir"
  git -C "$source_dir" init -q
  git -C "$source_dir" remote add origin https://github.com/streetpea/chiaki-ng.git
fi
git -C "$source_dir" fetch --depth 1 origin "$commit"
git -C "$source_dir" checkout --detach "$commit"
git -C "$source_dir" submodule update --init --depth 1 \
  third-party/nanopb third-party/jerasure third-party/gf-complete third-party/curl
