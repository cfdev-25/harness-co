#!/usr/bin/env sh
# Builds the probe binary for THIS host and records every present binary's
# checksum in SHA256SUMS (06 §8.2). Both the binaries and SHA256SUMS are
# committed; `probeSandbox` refuses a binary that does not match its line.
#
# CI cross-build. There is no cross-compiler here and none is wanted: each of
# the four binaries is built on a runner of its own platform and architecture
# — macos-14 (darwin-arm64), macos-13 (darwin-x64), ubuntu-latest (linux-x64),
# ubuntu-24.04-arm (linux-arm64) — by running this script once per runner, and
# the four SHA256SUMS lines are collected into one committed file. A Darwin
# binary cannot be produced from Linux at all (the SDK is not redistributable).
set -eu

dir=$(cd "$(dirname "$0")" && pwd)
case "$(uname -s)" in
Darwin) plat=darwin ;;
Linux) plat=linux ;;
*) echo "build.sh: no probe binary is defined for $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
arm64 | aarch64) arch=arm64 ;;
x86_64) arch=x64 ;;
*) echo "build.sh: no probe binary is defined for $(uname -m)" >&2; exit 1 ;;
esac

out="$dir/$plat-$arch"
if [ "$plat" = darwin ]; then
	# Apple does not support statically linking libSystem, so the macOS probe is
	# dynamically linked; clang ad-hoc signs it, which §8.2 asks for.
	clang -O2 -Wall -Werror -o "$out" "$dir/src/probe.c"
else
	# Static: inside the jail the binary's own directory is an empty tmpfs, so a
	# loader dependency resolved from that directory would fail for the wrong
	# reason and the probe would pass without proving anything.
	"${CC:-cc}" -O2 -Wall -Werror -static -o "$out" "$dir/src/probe.c"
fi

cd "$dir"
for f in darwin-arm64 darwin-x64 linux-x64 linux-arm64; do
	[ -f "$f" ] || continue
	if command -v sha256sum >/dev/null 2>&1; then sha256sum "$f"; else shasum -a 256 "$f"; fi
done >SHA256SUMS
echo "built $plat-$arch"
