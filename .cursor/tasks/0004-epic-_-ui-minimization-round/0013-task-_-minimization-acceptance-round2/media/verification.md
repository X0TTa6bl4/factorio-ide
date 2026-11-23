# Повторная приёмка минимизации

Дата: 2026-11-23. Образ `f-logic-dev:1.56.1`, Node 22.20.0, Playwright 1.56.1. Библиотека — `f-logic-ui-check:1.56.1`. Команды из корня, рабочая копия смонтирована в контейнер. Снимки этого прогона лежат рядом с отчётом. Числа раскладки — в `matrix.json`.

## Результат

Пункты 15–18 подтверждены прогоном. Критических регрессий 1–14 нет. Эпик закрыт.

Черновик вкладки по-прежнему хранит только текст схемы. Уход в руководство выгружает страницу, поэтому правка сценария и тик Worker не возвращаются вместе с кнопкой «Назад»; текст схемы в `f-logic.editor-draft.v1` остаётся. Это совпадает с контрактом 0010, а не с потерей при «Очистить проект».

## Замечания 15–18

| Пункт | Задача | Что подтверждено |
|---|---|---|
| 15 | [0010](../../0010-task-_-unified-workbench-views/0000-unified-workbench-views.md) | На `/`, `pages/configure/`, `/factorio-ide/` и `/factorio-ide/pages/configure/` шапка с «Код», «Сети» и «События» стоит внутри `#code-panel`. Отдельного `fl-panel__head` у workbench нет. При смене вида, ширины 320–1920 и масштаба текста 200% три кнопки, undo/redo, «Меню» и «Запустить» остаются в окне. |
| 16 | [0010](../../0010-task-_-unified-workbench-views/0000-unified-workbench-views.md), [0012](../../0012-task-_-topbar-overflow-menu/0000-topbar-overflow-menu.md) | Три кнопки одного класса. «События» не меняет URL. «Проверить» и «Шаг» исполняют Arrival в Worker: на границе 1 в единственной `#live-signals` есть signal-A, бейдж «События». Возврат к коду ставит бейдж «Схема». Undo/redo схемы не затирает правку сценария, пока страница не выгружена. «Новый черновик» и `#open-events` отсутствуют. |
| 17 | [0012](../../0012-task-_-topbar-overflow-menu/0000-topbar-overflow-menu.md) | На девяти адресах из корня и под `/factorio-ide/` одна кнопка «Меню». Пункты — «Документация» и «Очистить проект». Ссылка ведёт в руководство. Отмена оставляет ошибочный текст схемы и именованную запись `f-logic.projects.v1` / `f-logic.project.v1.p9`. Подтверждение возвращает пример, останавливает сценарий и не трогает именованную запись. После перезагрузки пример остаётся. Меню на 320 px помещается в окно. Enter открывает, Escape возвращает фокус. Касание открывает «События» и меню. |
| 18 | [0011](../../0011-bug-_-gutter-column-width/0000-gutter-column-width.md) | На 901, 1440 и 1920 px колонка `#gutter` — 18 px при 40 строках, один прямоугольник на номер, без обрезки. `scrollLeft` номеров — 0. Колесо над номерами двигает textarea, `scrollTop` совпадает. «К месту» выделяет `not_real_round2` и выравнивает номера с полем. На прямой `pages/event/` `#code-gutter` тоже 18 px. |

## Регрессия 1–14

Повторный прогон [приёмки 0009](../../0009-task-_-minimization-acceptance/media/verification.md) и соседних browser-тестов не дал падений. Наблюдаемое поведение волны 1 сохранилось, кроме навигации, которую заменили пункты 15–17.

| № | Что осталось |
|---|---|
| 1 | `#document-hint` нет. Tab, Enter и сочетание форматирования читаются в статье «Редактор». |
| 2 | `#undo` и `#redo` в заголовке панели кода. На точном указателе ширина 32 px, на грубом 36 px и высота не меньше 40. |
| 3 | `#play` 40×40, видимого слова нет. |
| 4 | В кнопке скорости число, заголовок меню «Скорость». |
| 5 | В строке тика остаётся значение, подпись «Текущий тик» скрыта. |
| 6 | Скорость, схема и списки событий идут через `data-select`. Каталог `compact.html`: 42 сочетания, axe без нарушений. |
| 7 | Колесо и касание над номерами двигают textarea. `scrollLeft` gutter остаётся 0. |
| 8 | На 320 px и при масштабе 200% причина переносится, «К месту» видно в окне. |
| 9 | До 900 px одна панель, с 901 px сети справа. Кнопка «События» больше не ссылка: это пункт 16. |
| 10 | Прямая `pages/event/` оставляет «Проверить» и «Остановить» словами. Запуска, паузы, скорости и шага назад нет. |
| 11 | Кнопки «Совместимость» нет. Статья содержит снимок 2.1.24 и отказ заявлять игровую совместимость. |
| 12 | Руководство открывается пунктом меню, не отдельной кнопкой topbar. Якоря и узкая ширина проходят `docs-page.test.mjs`. |
| 13 | `h1` редактора скрыт классом `fl-sr`. |
| 14 | «Шаг», «Шаг назад» и «Сброс» — иконки с `aria-label`. |

Внешнего scroll документа на рабочих экранах нет. Повторяющихся id и оборванных `aria-controls`, `aria-labelledby`, `aria-describedby` в проверенных экранах нет. Длинные строки кода уходят во внутреннюю прокрутку textarea.

## Прогон

Код выхода 0.

```sh
docker run --rm --init --ipc=host --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e F_LOGIC_DEV_PACKAGE=/opt/f-logic-dev/package.json \
  -v "$PWD:/workspace" -w /workspace f-logic-dev:1.56.1 \
  node dev/commands.mjs test
```

360 unit-тестов, код выхода 0. В них конфигурация, сети, события и Worker.

```sh
docker run --rm --init --ipc=host --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e F_LOGIC_DEV_PACKAGE=/opt/f-logic-dev/package.json \
  -v "$PWD:/workspace" -w /workspace f-logic-dev:1.56.1 \
  node --test --test-concurrency=1 --test-reporter=spec \
  test/browser/minimization-acceptance-round2.test.mjs \
  test/browser/minimization-acceptance.test.mjs \
  test/browser/editor-panels.test.mjs \
  test/browser/configure-page.test.mjs \
  test/browser/event-page.test.mjs \
  test/browser/event.test.mjs \
  test/browser/topbar-menu.test.mjs \
  test/browser/screen-layout.test.mjs \
  test/browser/compact-toolbar.test.mjs \
  test/browser/docs-page.test.mjs \
  test/browser/networks-page.test.mjs \
  test/browser/project-page.test.mjs \
  test/browser/shared-select.test.mjs \
  test/browser/revision-acceptance.test.mjs \
  test/browser/examples.test.mjs \
  test/browser/debugger-page.test.mjs \
  test/browser/circuit-page.test.mjs
```

78 тестов, код выхода 0. Сквозной сценарий — `minimization-acceptance-round2.test.mjs`: оба адреса редактора из корня и под `/factorio-ide/`, прямая `pages/event/`, меню девяти страниц, ширины 320/390/768/900/901/1440/1920, высоты 600/900, масштаб текста 200%, точный и грубый указатель, клавиатура.

`test:full` в `dev/commands.mjs` есть и добавляет c8. Для этой приёмки запущены `test` и перечисленный browser-набор: покрытие движка этот проход не менял.

```sh
docker run --rm --ipc=host \
  -v "$PWD:/workspace:ro" \
  -v /tmp/f-logic-0013-ui:/artifacts \
  -e UI_ARTIFACTS=/artifacts \
  f-logic-ui-check:1.56.1 node ui/tests/compact.mjs
```

`PASS: 42 viewport/path/browser combinations, controls, menus, panels, history, scrolling, axe`, код выхода 0. Chromium, Firefox и WebKit.

## Снимки

Просмотрены `workbench-320.png`, `workbench-390.png`, `workbench-768.png`, `workbench-900.png`, `workbench-901.png`, `workbench-1440.png`, `workbench-1920.png`, `workbench-events-1440.png`, `workbench-text-200-390.png`, `workbench-touch-390.png`, `menu-320.png`, `menu-1440.png`, `gutter-1440.png`, `gutter-1920.png`.

На 320 px пульт, три кнопки и история помещаются в одной колонке. На 900 px виден код, на 901 px справа появляется таблица сетей. На 1440 px «События» открывает сценарий под той же шапкой, бейдж таблицы — «События». Номера на широком окне стоят одной колонкой. Меню на узкой и широкой ширине не выходит за край. При масштабе 200% «К месту» остаётся в строке статуса.

Снимки волны 1 в каталоге 0009 этот прогон не заменяют как исторический отчёт: текст [verification.md](../../0009-task-_-minimization-acceptance/media/verification.md) описывает тогдашний интерфейс, включая ссылку «События».

## Документация

`.cursor/docs/specs/editor.md`, `ui/README.md` и руководство описывают шапку внутри панели кода, три кнопки без смены адреса, прямую `pages/event/`, меню «Документация» / «Очистить проект» и черновик, который хранит только схему. Указания перейти по «События» на другую страницу и кнопки «Новый черновик» в заголовке нет. Колонка номеров в спецификации редактора ограничена числом цифр.

## Открытые дефекты

Нет.
