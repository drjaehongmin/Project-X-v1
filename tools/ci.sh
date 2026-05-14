#!/usr/bin/env bash
# Minimal CI script: install, lint, typecheck, test.
# Used by the `ci` npm script and by external CI runners.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "::group::pnpm install"
pnpm install --frozen-lockfile
echo "::endgroup::"

echo "::group::lint"
pnpm run lint
echo "::endgroup::"

echo "::group::typecheck"
pnpm run typecheck
echo "::endgroup::"

echo "::group::test"
pnpm run test
echo "::endgroup::"
