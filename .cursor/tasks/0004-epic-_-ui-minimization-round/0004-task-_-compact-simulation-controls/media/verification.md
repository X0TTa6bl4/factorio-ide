# Проверка компактного пульта

Дата: 2026-11-22. Образец `f-logic-dev:1.56.1`, Playwright 1.56.1. Экран событий не менялся: его завершает задача 0008. «Совместимость», меню «Ещё» и «Новый черновик» остаются до 0001. Undo/redo редактора остаются в тулбаре до 0005.

## Что изменилось на экранах

| Экран | Пульт | Скорость | Topbar |
|---|---|---|---|
| `/`, `pages/configure/` | play/pause, шаг, назад, сброс — иконки 40×40 | Число `1/2/4/10`, список «тик/с», заголовок «Скорость» | Видимого «Редактор» нет, `h1` остаётся |
| `pages/debugger/` | те же четыре действия и бейдж состояния | Тот же набор | «Отладчик» на месте |
| `pages/circuit/` | «Запустить» отключён, шага назад нет, шаг и сброс — иконки | Отключено, число `1`, пункт «1 тик за шаг» | «Контур» на месте |
| `pages/networks/` | просмотр, шаг и сброс — иконки; «Запустить», отмена и возврат документа остаются текстом | Скорости нет | «Сети» на месте |

Значение скорости редактора и отладчика — тики в секунду. Пауза таймера по-прежнему 1000, 500, 250 и 100 мс. Имя «Скорость» и подпись «Текущий тик» скрыты с экрана и остаются доступными.

## Прогон

Команды из корня, код выхода 0:

```sh
docker run --rm --init --ipc=host --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e F_LOGIC_DEV_PACKAGE=/opt/f-logic-dev/package.json \
  -v "$PWD:/workspace" -w /workspace f-logic-dev:1.56.1 \
  node --test --test-reporter=spec \
  test/browser/compact-toolbar.test.mjs \
  test/browser/shared-select.test.mjs
docker run --rm --init --ipc=host --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e F_LOGIC_DEV_PACKAGE=/opt/f-logic-dev/package.json \
  -v "$PWD:/workspace" -w /workspace f-logic-dev:1.56.1 \
  node --test --test-reporter=spec \
  test/browser/configure-page.test.mjs \
  test/browser/debugger-page.test.mjs \
  test/browser/circuit-page.test.mjs \
  test/browser/networks-page.test.mjs \
  test/browser/screen-layout.test.mjs \
  test/unit/debugger/session.test.mjs
```

- `compact-toolbar.test.mjs`: 2 теста. Play/pause на обоих адресах редактора остаётся 40×40, имя меняется между «Запустить» и «Приостановить», шаг назад на нуле отключён и включается после тика. На 320 px страница и полоса команд не шире окна. У отладчика заголовок виден, у контура нет шага назад, у сетей нет скорости.
- `shared-select.test.mjs`: 6 тестов. Кнопка скорости показывает `1` и `10`, меню не шире 145 px и содержит «Скорость». Отключённая скорость контура не открывается и остаётся `1`.
- Редактор, отладчик, контур, сети, каркас и unit playback: 33 теста, без падений. Смена скорости на `10`, затем на `1`, не добавляет тик во время паузы.
- `git diff --check`: код 0.
- `ui/tests/check.mjs` и `ui/tests/compact.mjs` не запускались: образец библиотеки и `widgets.js` не менялись.

Снимки не снимались: проверялись размеры, имена, фокус и прогон, а не новая композиция панелей.
