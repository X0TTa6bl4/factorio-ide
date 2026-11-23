# Проверка меню topbar 0004/0012

Дата: 2026-11-23. Образ `f-logic-dev:1.56.1`, Node 22.20.0, Playwright 1.56.1. Команды из корня проекта, рабочая копия смонтирована в контейнер.

Финальный browser-прогон, код 0, 29/29:

```sh
docker run --rm --init --ipc=host --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e F_LOGIC_DEV_PACKAGE=/opt/f-logic-dev/package.json \
  -v "$PWD:/workspace" -w /workspace f-logic-dev:1.56.1 \
  node --test --test-reporter=spec \
  test/browser/topbar-menu.test.mjs \
  test/browser/docs-page.test.mjs \
  test/browser/compact-toolbar.test.mjs \
  test/browser/screen-layout.test.mjs \
  test/browser/debugger-page.test.mjs \
  test/browser/circuit-page.test.mjs \
  test/browser/examples.test.mjs \
  test/browser/minimization-acceptance.test.mjs
```

Раньше в том же образе прошли `test/unit/runtime/event-script.test.mjs` (включая `discard`) и `test/unit/docs/guide-samples.test.mjs`. Полный `./dev/f-logic test:full` в этом заходе не запускался.

- На девяти адресах (`/`, `pages/configure/`, `pages/event/`, `pages/debugger/`, `pages/circuit/`, `pages/networks/`, `pages/project/`, `pages/examples/`, `pages/docs/`) одна кнопка «Меню». Пункты — «Документация» и «Очистить проект». Отдельной ссылки «Документация» и кнопки «Новый черновик» нет. Относительный адрес руководства верный из корня, подкаталога и под `/factorio-ide/`.
- Меню открывается кликом, Enter и касанием, закрывается Escape с возвратом фокуса на кнопку и кликом снаружи. На 320 и 390 px панель остаётся в окне. Смена ширины не снимает фокус с кнопки. Снимки: `menu-320.png`, `menu-390.png`, `menu-1440.png`.
- Отмена подтверждения оставляет текст схемы, настройки сценария, историю отмены и текущий тик прогона.
- Подтверждение на `/`, `pages/configure/` и под `/factorio-ide/` возвращает пример схемы и исходный сценарий, останавливает событийный прогон, не трогает `f-logic.projects.v1`. После перехода в руководство и перезагрузки прежний текст не восстанавливается.
- С `pages/event/`, `pages/project/` и `pages/networks/` очищается тот же ключ `f-logic.editor-draft.v1`. Локальный сценарий стенда, именованная запись и текст экрана сетей остаются. Следующий вход в редактор открывает пример.
- Если `sessionStorage.setItem` бросает исключение, пользователь видит «Не удалось записать черновик. Проект не очищен.», текст и уже записанный черновик не меняются.

`ui/README.md`, `.cursor/docs/specs/editor.md` и руководство описывают меню и объём очистки. В каталоге `dialog.html` есть закрытое меню и открытый образец; `compact.html` использует ту же кнопку. Образец не записывает черновик редактора.
