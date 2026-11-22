#!/bin/bash
# Run inside the documented linux/amd64 Docker container. Workspace is read-only.
set -eu
probe_source=/workspace/tools/factorio-catalog/runtime-probe/mod
cd /check
apt-get update -qq
apt-get install -y -qq --no-install-recommends ca-certificates curl xz-utils > packages.log
if [ ! -f factorio.tar.xz ]; then
  curl --fail --location --max-time 300 --retry 2 --silent --show-error \
    --output factorio.tar.xz https://factorio.com/get-download/2.1.24/headless/linux64
fi
printf '%s  %s\n' c49b66cff90aceff87b30f2973af0df7f51712cb2ee3153e0169d9bed46a964f factorio.tar.xz | sha256sum --check
tar -xf factorio.tar.xz
factorio/bin/x64/factorio --version
mkdir -p mods/f-logic-catalog-probe_0.1.0 output/base output/space-age
cp "$probe_source/info.json" "$probe_source/control.lua" mods/f-logic-catalog-probe_0.1.0/
for profile in base space-age; do
  if [ "$profile" = base ]; then enabled=false; else enabled=true; fi
  cat > mods/mod-list.json <<EOF
{"mods":[{"name":"base","enabled":true},{"name":"elevated-rails","enabled":$enabled},{"name":"quality","enabled":$enabled},{"name":"recycler","enabled":$enabled},{"name":"space-age","enabled":$enabled},{"name":"f-logic-catalog-probe","enabled":true}]}
EOF
  cat > config.ini <<EOF
[path]
read-data=/check/factorio/data
write-data=/check/output/$profile
EOF
  factorio/bin/x64/factorio --config /check/config.ini --mod-directory /check/mods \
    --create /check/output/$profile/probe.zip > output/$profile/run.log 2>&1 || {
      tail -40 output/$profile/run.log
      exit 1
    }
  tail -6 output/$profile/run.log
done
