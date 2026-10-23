#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TMPDIR_TEST=$(mktemp -d)
trap 'rm -rf "$TMPDIR_TEST"' EXIT HUP INT TERM

printf 'println(ARGS)\n' > "$TMPDIR_TEST/args.triad"
actual=$(TRIAD_JULIA="$(command -v julia)" "$ROOT/bin/triad" \
    "$TMPDIR_TEST/args.triad" 'spazio qui' 'bang!arg')
[ "$actual" = '["spazio qui", "bang!arg"]' ]

actual=$(PATH="$ROOT/bin:$PATH" triad --version)
[ "$actual" = 'triad 0.2.0' ]

printf '#!/usr/bin/env triad\nprintln(ARGS)\n' > "$TMPDIR_TEST/hello.triad"
chmod +x "$TMPDIR_TEST/hello.triad"
actual=$(PATH="$ROOT/bin:$PATH" "$TMPDIR_TEST/hello.triad" 'spazio qui' 'bang!arg')
[ "$actual" = '["spazio qui", "bang!arg"]' ]

set +e
"$ROOT/bin/triad" "$TMPDIR_TEST/missing.triad" >/dev/null 2>&1
exit_status=$?
set -e
[ "$exit_status" -eq 1 ]

printf '%s\n' 'POSIX launcher: OK'