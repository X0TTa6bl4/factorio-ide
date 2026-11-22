# Проверка панелей заголовка

Дата: 2026-11-22. Образец `f-logic-dev:1.56.1`, Playwright 1.56.1. Экран событий не перевёрстывался: его завершает задача 0008. Диагностика остаётся в колонке сетей до 0007.

## Что изменилось

На `/` и `pages/configure/` заголовок рабочей области содержит кнопки раскрытия «Код» и «Сети», ссылку «События» на `pages/event/` и undo/redo. Ссылка не входит в группу раскрытия и не обещает общего прогона. Кнопки истории 32×32 при точном указателе и 36×40 при грубом; пульт симуляции остаётся 40×40. Шире 900 px код слева, сети справа и скрываются своей кнопкой. До 900 px видна одна панель, сначала код. Таблица сетей одна. Смена ширины не прячет панель с фокусом и не создаёт новый прогон.

## Прогон

Команда из корня, код выхода 0, `--test-concurrency=1`:

```sh
docker run --rm --init --ipc=host --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e F_LOGIC_DEV_PACKAGE=/opt/f-logic-dev/package.json \
  -v "$PWD:/workspace" -w /workspace f-logic-dev:1.56.1 \
  node --test --test-concurrency=1 --test-reporter=spec \
  test/browser/editor-panels.test.mjs \
  test/browser/configure-page.test.mjs \
  test/browser/screen-layout.test.mjs \
  test/browser/revision-acceptance.test.mjs \
  test/browser/compact-toolbar.test.mjs
```

23 теста, без падений.

- `editor-panels.test.mjs`: переключение не меняет textarea, таблицу и тик; undo/redo переживают скрытие сетей. На 390 px сначала виден код, фокус в поле фильтра переживает сужение, фокус в коде — расширение. Грубая точка: undo 36×40.
- `configure-page.test.mjs`: подсказки, подчёркивание, переход к ошибке, черновик со страницы событий, история и tooltip. Undo/redo вне пульта, 32×32.
- `screen-layout.test.mjs`: на 320–768 px колонка сетей закрыта и код внутри окна; шире 900 px колонки рядом, правая не уже 16rem. Документ снаружи не прокручивается.
- `revision-acceptance.test.mjs`: переход «События» сохраняет черновик и возвращает его.
- `compact-toolbar.test.mjs`: play/pause остаётся 40×40.

`git diff --check` по затронутым файлам редактора: код 0. `ui/tests/check.mjs` не запускался: библиотечный образец и `workspace.html` не менялись.
