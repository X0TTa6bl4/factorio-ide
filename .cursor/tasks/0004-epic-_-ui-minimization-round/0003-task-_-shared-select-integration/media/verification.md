# Проверка общего выпадающего контроля

Дата: 2026-11-22. Образцы `f-logic-dev:1.56.1` и `f-logic-ui-check:1.56.1`, Playwright 1.56.1. Компактный тулбар и панели рабочих экранов не менялись: это задачи 0004, 0005 и 0008.

## Перечень полей

Уже были на `data-select`, пустого заголовка меню не было, подписи полей снаружи сохранены:

| Поле | Страница | Что осталось |
|---|---|---|
| `#speed` | `/`, `pages/configure/` | Значения `1000/500/250/100`, внешняя подпись «Скорость», без поиска и без заголовка меню |
| `#speed` | `pages/circuit/` | Отключён, значение `step` |
| `#preset` | `pages/circuit/` | `observe` / `spin` |
| `#port` | `pages/networks/` | Placeholder «Нет порта», без своего фильтра |
| `#network-results` | `pages/networks/` | Поиск имени сети, не dropdown |
| меню каретки | `/`, `pages/configure/` | `data-suggest="caret"`, не dropdown |
| страницы событий и примеров | `pages/event/`, `pages/examples/` | Выпадающих полей нет |

Переведены на тот же контракт или дополнены его данными:

| Поле | Страница | Изменение |
|---|---|---|
| `#scheme` | `pages/debugger/` | `data-search="true"`, фильтр собирает `buildSelect` |
| `#network` | `pages/debugger/`, `pages/networks/` | `data-search="true"` |
| `#port` | `pages/networks/` | При диагностике порта кнопка получает `aria-invalid` и `aria-describedby="network-error"` |
| `#event-device` | `pages/project/` через `ui/components/project-file.html` | Ручная разметка меню заменена на `data-select` и `data-options`; id, значение и `change` сохранены |

`data-menu-title` из пробелов не создаёт блок. Стиль заголовка живёт в `components.css`; пустой заголовок не занимает место. Каталог переписывает `data-label-id` вместе с id фрагмента.

## Прогон

Команды из корня, код выхода 0:

```sh
docker run --rm --init --ipc=host -v "$PWD:/workspace" -w /workspace f-logic-dev:1.56.1 \
  node --test --test-reporter=spec \
  test/browser/shared-select.test.mjs \
  test/browser/debugger-page.test.mjs \
  test/browser/networks-page.test.mjs \
  test/browser/project-page.test.mjs \
  test/browser/circuit-page.test.mjs \
  test/browser/screen-layout.test.mjs
docker run --rm --ipc=host -v "$PWD:/workspace:ro" -v /tmp/f-logic-ui-artifacts:/artifacts \
  f-logic-ui-check:1.56.1 node ui/tests/compact.mjs
docker run --rm --ipc=host -v "$PWD:/workspace:ro" -v /tmp/f-logic-ui-artifacts:/artifacts \
  f-logic-ui-check:1.56.1 node ui/tests/check.mjs
```

- `shared-select.test.mjs`: 6 тестов. Оба адреса редактора совпадают по скорости; смена значения не меняет текст схемы. Escape возвращает фокус, Tab закрывает список. Поиск схемы на 320 px оставляет меню в окне. Отключённая скорость контура не открывается, сценарий меняется. Ошибка порта видна на кнопке. Выбор события меняет текст. Касание на 390 px открывает скорость.
- Соседние browser-тесты отладчика, сетей, схемы, контура и каркаса: 14 тестов, без падений.
- `compact.mjs`: 42 сочетания, код 0, заголовок скорости образца на месте.
- `check.mjs`: каталог и workspace, Chromium/Firefox/WebKit, код 0.
- `git diff --check`: код 0.

Снимки этой задачи не снимались: проверялось поведение списков, а не новая раскладка экрана.
