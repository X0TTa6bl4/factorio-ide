# Проверка единой прокрутки gutter

Дата: 2026-11-22. Образцы `f-logic-dev:1.56.1` и `f-logic-ui-check:1.56.1`, Playwright 1.56.1.

## Что изменилось

Единственный источник `scrollTop` и `scrollLeft` — textarea. У `.fl-editor__gutter` больше нет собственной прокрутки: `overflow: hidden`, `overflow-anchor: none`, колесо и касание над номерами передаются в текстовое поле. Номера повторяют только вертикаль; горизонталь сдвигает текст и слой подсветки. То же поведение на `/`, `pages/configure/`, `pages/event/` и в редакторе страницы сетей, потому что они собирают один `mountEditor` и `mountCodePaint`. Образец `compact-workbench` оставляет свой показ строк, а колесо больше не обрабатывает вторым слушателем.

## Прогон

Команды из корня, код выхода 0.

```sh
docker run --rm --init --ipc=host --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e F_LOGIC_DEV_PACKAGE=/opt/f-logic-dev/package.json \
  -v "$PWD:/workspace" -w /workspace f-logic-dev:1.56.1 \
  node --test --test-concurrency=1 --test-reporter=spec \
  --test-name-pattern "номера строк|подчёрк|форматирование, Tab" \
  test/browser/configure-page.test.mjs test/browser/event-page.test.mjs
```

4 теста, без падений.

- Оба адреса редактора, 1440 и 390 px: колесо над номерами, горизонтальное колесо, касание, PageDown, вставка, undo, переход «К месту» и сужение окна держат номера и подсветку на тексте. Документ снаружи не шире окна.
- Страница событий, 390 и 1440 px: те же жесты, вставка, отмена символа, программный `scrollTop` и resize.
- Прежние проверки форматирования и подчёркивания ошибки на обоих адресах проходят.

```sh
docker run --rm --ipc=host --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e UI_ARTIFACTS=/artifacts \
  -v "$PWD:/workspace:ro" -v /tmp/f-logic-ui-artifacts:/artifacts \
  -w /workspace f-logic-ui-check:1.56.1 node ui/tests/compact.mjs
```

42 сочетания viewport/путь/браузер, включая колесо над gutter. Код выхода 0.

```sh
docker run --rm --ipc=host --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e UI_ARTIFACTS=/artifacts \
  -v "$PWD:/workspace:ro" -v /tmp/f-logic-ui-artifacts:/artifacts \
  -w /workspace f-logic-ui-check:1.56.1 node ui/tests/check.mjs
```

Каталог и workspace, Chromium/Firefox/WebKit. Код выхода 0.

`git diff --check` по затронутым файлам: код 0.

В Chromium этой сборки событие `scroll` у textarea приходит кадром позже установки `scrollTop`. Слушатель догоняет gutter и подсветку в этом событии; проверки ждут совпадения, а не читают координаты в том же вызове.
