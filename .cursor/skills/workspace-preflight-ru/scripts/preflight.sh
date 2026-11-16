#!/usr/bin/env bash
# Read-only snapshot of this workspace; no sibling repos or service startup.
set -eu

if [[ $# -gt 0 ]]; then
  case "$1" in
    -h|--help) echo 'Usage: preflight.sh'; exit 0 ;;
    *) echo 'Usage: preflight.sh' >&2; exit 2 ;;
  esac
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
workspace_root="$(cd "$script_dir/../../../.." && pwd)"
printf 'workspace  %s\n' "$workspace_root"

if git_root="$(git -C "$workspace_root" rev-parse --show-toplevel 2>/dev/null)"; then
  branch="$(git -C "$git_root" symbolic-ref --short -q HEAD || true)"
  if [[ -z "$branch" ]]; then
    branch="detached@$(git -C "$git_root" rev-parse --short HEAD)"
  fi
  dirty="$(git -C "$git_root" status --porcelain | wc -l | tr -d ' ')"
  printf 'git  root=%s  branch=%s  dirty=%s\n' "$git_root" "$branch" "$dirty"
else
  echo 'git  not-initialized'
fi

found_manifest=no
for manifest in package.json tsconfig.json composer.json pyproject.toml Cargo.toml go.mod; do
  if [[ -f "$workspace_root/$manifest" ]]; then
    printf 'manifest  %s\n' "$manifest"
    found_manifest=yes
  fi
done
if [[ "$found_manifest" == no ]]; then
  echo 'manifest  none'
fi
echo 'verdict  read-only-snapshot-complete'
