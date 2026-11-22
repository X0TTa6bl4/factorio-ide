---
type: subtask
status: done
priority: medium
created: 2026-11-14
updated: 2026-11-18
parent: ./0000-event-script-editor.md
---

# Проверка сценариев

Родитель: [Страница JavaScript-сценариев](./0000-event-script-editor.md).

## Skills этого шага

- Реализация: `repo-orientation-ru`; изменение спецификаций: `task-sdd-handoff-ru`.
- Проверка: профиль родителя и [матрица](media/test-matrix.md).

## Результат

Выполнить матрицу, связать каждое правило с тестом, записать фактические результаты и объяснить исключения.

## Границы

### Входит

- Самостоятельный результат шага и относящиеся проверки.

### Не входит

- Соседние этапы и самовольное решение открытых контрактов.

## План

- [x] Подготовить результат и проверки.

18.11.2026, `./dev/f-logic test:full`, exit 0, 159/159. Настоящий Worker, не мок страницы.

| ID | Тест | Результат |
|---|---|---|
| EW-01 | `test/browser/event-page.test.mjs`: наследник на `/factorio-ide/pages/event/`, класс Arrival, Worker загружен, `/api/` нет | tick 0, оболочка EventCombinator |
| EW-02 | тот же тест: step и reset | 0 → 1 → 0, `arrived` true затем false, runId сменился |
| EW-03 | страница во время зависания и unit `повторный шаг` | второй step → `step-busy` |
| EW-04 | страница: `while (true)` при лимите 300 мс; отдельно `test/browser/event/` | `timeout`, UI `alive`, tick 0, сигнал не опубликован |
| EW-05 | страница: Promise, `state = undefined`, `throw`, синтаксис, битый JSON | коды `async-main`, `invalid-state`, `script-error`; tick не растёт |
| EW-06 | страница: reset во время зависания, затем завершение старого step | новый runId, tick 0, сигнал 7 не появляется |
| EW-07 | `test/unit/runtime/tick.test.mjs` «ответ prepare сверяется с запросом»; поздний ответ в `event-worker.test.mjs` | чужие runId/revision/stepId/phase/tick и повтор ответа не публикуют шаг |
| EW-08 | `test/browser/event/partial.html` | `tick:0\|signal:2\|state:1\|wakes:5\|code:timeout\|alive:alive` |
| EW-09 | страница: stop и restore снимка; unit restore | runId прежний, init не повторяется, следующий step воспроизводим |
| EW-10 | страница: правка текста во время step, затем новая проверка | старый выход 7 не публикуется, после проверки выходит 4 |
| EW-11 | страница и `test/browser/event/` | `async-main`, продолжение Promise не публикуется |
| EW-12 | страница под `/factorio-ide/` | модули и Worker грузятся, прикладного API нет |
| EW-13 | страница: abort `event-worker.js` | статус не `busy`, проверка снова доступна, диагностика не пустая |
| EW-14 | страница после reset ждёт 300 мс | номер тика не меняется сам |

`pages/event/page.js` не входит в c8 по `src/`. Сессия, Worker и ядро в этом прогоне — 100% statements, branches, functions и lines.

## Критерии приёмки

- [x] Результат соответствует согласованным спецификациям; зависимые сценарии покрыты или исключения объяснены.

## Проверка

- Проверки по политике родителя; инструменты устанавливаются только в Docker.
- Предшественник: реализация 0200.

## Уточнение 16.11.2026

Запустить браузерные тесты настоящего Worker, зависания/timeout, позднего ответа после reset, повторного step и вложенного пути GitHub Pages. Проверить отсутствие частичной публикации.
