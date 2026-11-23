# Проверка ширины gutter

Дата: 2026-11-23. Образы `f-logic-dev:1.56.1` (Chromium) и `f-logic-ui-check:1.56.1` (Chromium, Firefox, WebKit). Playwright 1.56.1.

## Наблюдение до правки

Замечание 18 говорит, что на широком окне `#gutter` растягивается и номера встают в две колонки. Собственный прогон текущего дерева этого не показал.

На `/` после 0010 вычисленная сетка `.fl-editor` была `34px` и остаток stage. У gutter `white-space: pre`, `column-count: auto`. Ширина колонки на 901, 1440 и 1920 px оставалась 34 px при 40, 100 и 1000 строках. В Chromium и Firefox у каждого номера один прямоугольник глифа. В WebKit к нему добавляется нулевой по ширине фрагмент конца строки: на снимке колонка одна. Четыре цифры «1000» (28.8 px) помещались в 34 px, но колонка не росла с числом цифр.

Снимки после правки: [gutter-1440.png](gutter-1440.png), [gutter-1920.png](gutter-1920.png).

## Правило

Колонка сетки — `max-content`. У `.fl-editor__gutter` ширина `max-content`, не уже 2.5ch и не шире 4.5ch, `justify-self: start`, `white-space: pre`. Свободная ширина stage уходит textarea. Рост колонки — только с числом цифр: 40 строк дают 18 px, 100 строк — 21.6 px, 1000 строк — 28.8 px. `scrollWidth` не больше `clientWidth`. `font-size`, `line-height` и верхний padding совпадают с textarea.

## Прогон

Код выхода 0.

```sh
docker run --rm --init --ipc=host --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e F_LOGIC_DEV_PACKAGE=/opt/f-logic-dev/package.json \
  -v "$PWD:/workspace" -w /workspace f-logic-dev:1.56.1 \
  node --test --test-concurrency=1 --test-reporter=spec --test-name-pattern "gutter|номера строк" \
  test/browser/configure-page.test.mjs \
  test/browser/event-page.test.mjs
```

3 теста, код выхода 0. `/` и `pages/configure/`: колесо, горизонтальный сдвиг текста, касание, клавиши, вставка, undo и «К месту» сохраняют соответствие номеров, текста и подсветки. Ширина gutter на 1440 и 390 px совпадает. Отдельный тест: 901/1440/1920/390/320 px, 40/100/1000 строк, встроенные события и их прокрутка. `pages/event/`: ширина `#code-gutter` на 390 и 1440 px совпала, колесо и программный `scrollTop` держат номера у текста.

```sh
docker run --rm --ipc=host \
  -v "$PWD:/workspace:ro" \
  -v /tmp/f-logic-0011-ui:/artifacts \
  -e UI_ARTIFACTS=/artifacts \
  f-logic-ui-check:1.56.1 node ui/tests/compact.mjs
```

`PASS: 42 viewport/path/browser combinations`, код выхода 0. Chromium, Firefox и WebKit. На 120 строках ширина gutter одинакова от 320 до 1920 px, номера в одной колонке, колесо и «К месту» образца сохраняют прокрутку.

Повторное измерение `/`, встроенных событий, `pages/event/` и `pages/configure/` в тех же трёх браузерах, код выхода 0:

| Браузер | 40 строк, 901/1440/1920/320/390 | 100 строк, 1920 | 1000 строк, 1920 | Код на 320 px |
|---|---|---|---|---|
| Chromium, Firefox, WebKit | 18 px | 21.6 px | 28.8 px | 284 px |

Лишних прямоугольников глифа и обрезания нет. Колесо над `#event-gutter` сдвигает textarea (Chromium и WebKit 0→120, Firefox 345→365), `scrollLeft` номеров остаётся 0. «К месту» на `pages/configure/` выделяет `SSignal` и держит номера, текст и подсветку на одном `scrollTop`.
