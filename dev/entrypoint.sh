#!/bin/sh
set -eu
if [ "$(id -u)" -eq 0 ]; then
  echo "f-logic-dev: контейнер запускается только обычным пользователем (--user \"\$(id -u):\$(id -g)\")." >&2
  exit 1
fi
cd /workspace
exec "$@"
