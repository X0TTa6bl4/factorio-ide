# Приёмка компактного интерфейса

Дата: 2026-11-22. Образы `f-logic-dev:1.56.1` и `f-logic-ui-check:1.56.1`, Playwright 1.56.1. Снимки этого прогона лежат рядом с отчётом.

## Результат

Все 14 замечаний подтверждены прогоном. Критических регрессий нет: документ рабочих экранов не прокручивается снаружи, горизонтального переполнения нет, действия на 320 px остаются в окне.

## Замечания

| № | Задача | Что подтверждено |
|---|---|---|
| 1 | [0001](../../0001-task-_-user-documentation/0000-user-documentation.md), [0007](../../0007-task-_-editor-status-diagnostics/0000-editor-status-diagnostics.md) | На `/` и `pages/configure/` нет `#document-hint`. Tab, Enter и Ctrl+Alt+L / ⌥⌘L читаются в статье «Редактор». |
| 2 | [0005](../../0005-task-_-editor-header-panels/0000-editor-header-panels.md) | `#undo` и `#redo` в заголовке рабочей области, не в пульте. На точном указателе 32 px, на грубом 36×40. |
| 3 | [0004](../../0004-task-_-compact-simulation-controls/0000-compact-simulation-controls.md) | `#play` 40×40, видимого слова нет, имя меняется между «Запустить» и «Приостановить». |
| 4 | [0003](../../0003-task-_-shared-select-integration/0000-shared-select-integration.md), [0004](../../0004-task-_-compact-simulation-controls/0000-compact-simulation-controls.md) | В кнопке скорости число, в списке «тик/с», заголовок меню «Скорость». |
| 5 | [0004](../../0004-task-_-compact-simulation-controls/0000-compact-simulation-controls.md) | Подпись «Текущий тик» скрыта, в строке остаётся число. |
| 6 | [0002](../../0002-task-_-compact-ui-library/0000-compact-ui-library.md), [0003](../../0003-task-_-shared-select-integration/0000-shared-select-integration.md) | Общий `data-select`: заголовок, ширина, значение без подписи, поиск схемы и клавиатура. |
| 7 | [0006](../../0006-bug-_-gutter-scroll-owner/0000-gutter-scroll-owner.md) | Колесо и касание над номерами двигают textarea. `scrollTop` номеров совпадает с полем, `scrollLeft` номеров остаётся 0. |
| 8 | [0007](../../0007-task-_-editor-status-diagnostics/0000-editor-status-diagnostics.md) | Длинная причина переносится в `.fl-editor__status`, «К месту» рядом. Колонка сетей не держит панель диагностики. |
| 9 | [0005](../../0005-task-_-editor-header-panels/0000-editor-header-panels.md) | «Код» и «Сети» — кнопки раскрытия, «События» — ссылка. До 900 px одна панель, с 901 px сети справа. |
| 10 | [0008](../../0008-task-_-compact-event-page/0000-compact-event-page.md) | «Проверить» и «Остановить» словами. Запуска, паузы, скорости и шага назад нет. Настройки и состояние раскрываются. |
| 11 | [0001](../../0001-task-_-user-documentation/0000-user-documentation.md) | Кнопки «Совместимость» на рабочих страницах нет. Статья содержит снимок 2.1.24 и отказ заявлять игровую совместимость. |
| 12 | [0001](../../0001-task-_-user-documentation/0000-user-documentation.md) | Руководство открывается с рабочих экранов, якоря и мобильная панель проходят `docs-page.test.mjs`. |
| 13 | [0004](../../0004-task-_-compact-simulation-controls/0000-compact-simulation-controls.md) | В topbar редактора нет видимого «Редактор»: `h1` с классом `fl-sr`. |
| 14 | [0004](../../0004-task-_-compact-simulation-controls/0000-compact-simulation-controls.md), [0008](../../0008-task-_-compact-event-page/0000-compact-event-page.md) | «Шаг», «Шаг назад» и «Сброс» — иконки с `aria-label`. На событиях назад нет, шаг и сброс — иконки. |

## Прогон

Команды из корня, код выхода 0.

```sh
docker run --rm --init --ipc=host --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e F_LOGIC_DEV_PACKAGE=/opt/f-logic-dev/package.json \
  -v "$PWD:/workspace" -w /workspace f-logic-dev:1.56.1 \
  node --test --test-concurrency=1 --test-reporter=spec \
  test/browser/minimization-acceptance.test.mjs
```

3 теста, код выхода 0. Оба префикса `/` и `/factorio-ide/`: редактор, конфигурация, события, отладчик, контур, сети, примеры, схема, каталог, `compact.html` и `workspace.html`. Ширины 320, 390, 768, 900, 901, 1440 и 1920; высоты 600 и 900 на редакторе и событиях. Повторных id и оборванных `aria-controls` нет. Фокус в сетях при сужении до 390 px оставляет колонку. Фокус в коде при 320 px оставляет код. Меню скорости закрывается Escape и помещается в окно.

```sh
docker run --rm --init --ipc=host --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e F_LOGIC_DEV_PACKAGE=/opt/f-logic-dev/package.json \
  -v "$PWD:/workspace" -w /workspace f-logic-dev:1.56.1 \
  node --test --test-concurrency=1 --test-reporter=spec \
  test/browser/screen-layout.test.mjs \
  test/browser/editor-panels.test.mjs \
  test/browser/compact-toolbar.test.mjs \
  test/browser/shared-select.test.mjs \
  test/browser/event-page.test.mjs \
  test/browser/docs-page.test.mjs \
  test/browser/configure-page.test.mjs \
  test/browser/debugger-page.test.mjs \
  test/browser/circuit-page.test.mjs \
  test/browser/revision-acceptance.test.mjs
```

52 теста, код выхода 0.

```sh
docker run --rm --ipc=host \
  -v "$PWD:/workspace:ro" \
  -v /tmp/f-logic-0009-ui:/artifacts \
  f-logic-ui-check:1.56.1
docker run --rm --ipc=host \
  -v "$PWD:/workspace:ro" \
  -v /tmp/f-logic-0009-ui:/artifacts \
  f-logic-ui-check:1.56.1 node ui/tests/compact.mjs
```

Каталог и пример страницы: Chromium, Firefox и WebKit, код выхода 0. Сводка — `report.json`. Образец `compact.html`: 42 сочетания браузер/префикс/ширина, код выхода 0. Сводка — `compact-report.json`.

## Снимки

Просмотрены `editor-320.png`, `editor-390.png`, `editor-768.png`, `editor-900.png`, `editor-901.png`, `editor-1440.png`, `editor-1920.png`, `editor-status-320.png`, `editor-touch-390.png`, `event-390.png`, `event-1440.png`, `docs-compatibility-390.png`, `docs-editor-1440.png`, `compact-320.png`, `compact-1440.png`, `catalog-320.png`.

На 320 px пульт, складки и история помещаются, длинная ошибка переносится, «К месту» видно. На 900 px виден код, на 901 px справа появляется колонка сетей. На 390 px у событий открыты сети, «Проверить» и «Остановить» на месте. Статья «Совместимость» читается на телефоне.

## Документация

`ui/README.md` и `.cursor/docs/specs/editor.md` описывают рабочую колонку только с сетями и статус под кодом. Каталожный `editor-inspector.html` отдельно помечен как образец со свёрнутой диагностикой. Навигация рабочих страниц — ссылка «Документация», без меню «Ещё» и кнопки «Совместимость».

Страница `pages/networks/` по-прежнему пишет «Запустить», «Отменить» и «Вернуть» словами. Задачи 0004 и 0005 этот экран в перенос истории и подписей не брали; шаг и сброс там уже иконки. Это не ломает приёмку замечаний 1–14.
