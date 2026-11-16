#!/usr/bin/env bash
# Short, read-only diff summary for this workspace's actual Git root.
set -eu

if [[ $# -gt 0 ]]; then
  case "$1" in
    -h|--help) echo 'Usage: diff-stat.sh'; exit 0 ;;
    *) echo 'Usage: diff-stat.sh' >&2; exit 2 ;;
  esac
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
workspace_root="$(cd "$script_dir/../../../.." && pwd)"
if ! git_root="$(git -C "$workspace_root" rev-parse --show-toplevel 2>/dev/null)"; then
  echo 'git  not-initialized'
  exit 0
fi

branch="$(git -C "$git_root" symbolic-ref --short -q HEAD || true)"
printf 'git  root=%s  branch=%s\n' "$git_root" "${branch:-detached}"
if git -C "$git_root" rev-parse --verify HEAD >/dev/null 2>&1; then
  git -C "$git_root" diff HEAD --stat
else
  # A newly initialized repo can have staged files but no HEAD yet.
  git -C "$git_root" diff --cached --stat
  git -C "$git_root" diff --stat
fi
git -C "$git_root" ls-files --others --exclude-standard | sed -n '1,30s/^/untracked  /p'
