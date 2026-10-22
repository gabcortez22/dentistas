#!/usr/bin/env bash
# Installs graphify and registers its Claude Code skill in cloud sessions.
set -u
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
export PATH="$HOME/.local/bin:$PATH"
if ! command -v graphify >/dev/null 2>&1; then
  if command -v uv >/dev/null 2>&1; then
    uv tool install graphifyy >&2 || exit 0
  elif command -v pipx >/dev/null 2>&1; then
    pipx install graphifyy >&2 || exit 0
  else
    echo "graphify: neither uv nor pipx found, skipping" >&2
    exit 0
  fi
fi
graphify install --platform claude >&2 || true
exit 0
