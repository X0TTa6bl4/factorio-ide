# Проверка единой workbench

Дата: 2026-11-23. Образ `f-logic-dev:1.56.1`, Playwright из образа. Библиотека — `f-logic-ui-check:1.56.1`.

## Результат

На `/` и `pages/configure/` шапка с «Код», «Сети» и «События» стоит внутри `#code-panel`. Три кнопки одного класса меняют содержимое под шапкой и не меняют URL. «События» гоняет `EventScriptSession` в Worker: проверка, шаг, ошибка разбора, остановка и timeout. Таблица `#live-signals` одна; источник подписан «Схема» или «События». Тексты и истории не смешиваются. Черновик `f-logic.editor-draft.v1` после перезагрузки восстанавливает только схему.

Прямая `pages/event/` остаётся рабочей. На момент прогона 0010 кнопка «Новый черновик» оставалась в группе «Действия документа». 23.11.2026 задача 0012 убрала её и перенесла действие в пункт «Очистить проект» меню шапки.

## Прогон

Команды из корня, код выхода 0, кроме указанного промежуточного прогона.

```sh
docker run --rm --init --ipc=host --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e F_LOGIC_DEV_PACKAGE=/opt/f-logic-dev/package.json \
  -v "$PWD:/workspace" -w /workspace f-logic-dev:1.56.1 \
  node --test --test-concurrency=1 --test-reporter=spec \
  test/browser/editor-panels.test.mjs
```

4 теста, код выхода 0. Оба адреса: шапка внутри панели, три вида без смены URL, черновик, undo по активному редактору, таблица режима, Arrival, ошибка разбора, stop, timeout, resize 900↔901.

```sh
docker run --rm --init --ipc=host --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e F_LOGIC_DEV_PACKAGE=/opt/f-logic-dev/package.json \
  -v "$PWD:/workspace" -w /workspace f-logic-dev:1.56.1 \
  node --test --test-concurrency=1 --test-reporter=spec \
  test/browser/event-page.test.mjs \
  test/browser/screen-layout.test.mjs \
  test/browser/revision-acceptance.test.mjs
```

В общем прогоне эти файлы завершились без падений: 10 тестов страницы событий, раскладка и сквозной путь корня. Повтор `event-page.test.mjs` после разведения меню подсказок — 10 тестов, код выхода 0.

```sh
docker run --rm --init --ipc=host --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e F_LOGIC_DEV_PACKAGE=/opt/f-logic-dev/package.json \
  -v "$PWD:/workspace" -w /workspace f-logic-dev:1.56.1 \
  node --test --test-concurrency=1 --test-reporter=spec \
  test/browser/configure-page.test.mjs \
  test/browser/shared-select.test.mjs \
  test/browser/minimization-acceptance.test.mjs
```

27 тестов, код выхода 0. Промежуточный прогон `configure-page.test.mjs` падал на двух меню `[data-suggest=caret]`: у сценария отдельное меню `event-caret`, у схемы остаётся одно.

```sh
docker run --rm --ipc=host \
  -v "$PWD:/workspace:ro" \
  -v /tmp/f-logic-0010-ui:/artifacts \
  -e UI_ARTIFACTS=/artifacts \
  f-logic-ui-check:1.56.1 node ui/tests/compact.mjs
```

`PASS: 42 viewport/path/browser combinations`, код выхода 0. Chromium, Firefox и WebKit.
