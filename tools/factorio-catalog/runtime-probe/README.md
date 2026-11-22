# Read-only runtime probe · Factorio 2.1.24

Снимает значения, вычисленные настоящим игровым движком, отдельно от Lua data stage. Мод не содержит data.lua и не изменяет прототипы: на `on_init` читает восемь словарей `prototypes` и сохраняет `script-output/runtime.json`. Создание временной карты и сохранения выполняется внутри `/check`. Приложение, пользовательские сохранения и сырые снимки не изменяются.

Выполнение только в Docker. Из корня проекта:

```sh
mkdir -p /tmp/f-logic-factorio-runtime
docker run --rm --platform linux/amd64 \
  -v "$PWD:/workspace:ro" \
  -v /tmp/f-logic-factorio-runtime:/check \
  ubuntu:24.04@sha256:73b999393d07f2bf65a40373778a44dc9a6d54ad7718d29247d8ff9413c4d6a8 \
  bash /workspace/tools/factorio-catalog/runtime-probe/run.sh
```

Скрипт устанавливает curl/xz/CA только в одноразовый контейнер, фиксирует их пакетный журнал и проверяет SHA-256 официального архива. Linux x86_64 нужен для headless-бинарника; на Apple Silicon используется эмуляция Docker. Сеть требуется для Ubuntu-пакетов и первой загрузки архива. Версия игры и SHA закреплены; latest автоматически не подставляется.

Результаты:

- `/tmp/f-logic-factorio-runtime/output/base/script-output/runtime.json`
- `/tmp/f-logic-factorio-runtime/output/space-age/script-output/runtime.json`
- журналы `output/<profile>/run.log`, `packages.log`

Сохранённая сверка — [data/evidence/runtime-2.1.24-2026-11-18](../../../data/evidence/runtime-2.1.24-2026-11-18/README.md). Каталог получает только те факты, которые подтверждены полями; `selectable_in_game` не подменяет видимость в меню сигналов. Probe не запускает графическое меню, не создаёт подключённого игрока и не вызывает `request_translation`.
