# Окружение разработки и тестов

Команды ниже запускают Node.js, c8 и Playwright только внутри Docker. На хосте нужны Docker и оболочка `sh`. Конечному пользователю эти инструменты не нужны: страницы — статические HTML, CSS и нативные ES-модули.

Закреплённые версии лежат в [versions.env](versions.env), lockfile — в [package.json](package.json) и `package-lock.json`.

| Инструмент | Версия |
|---|---|
| Образ | `mcr.microsoft.com/playwright:v1.56.1-noble@sha256:f1e7e01021efd65dd1a2c56064be399f3e4de00fd021ac561325f2bfbb2b837a` |
| Локальный тег | `f-logic-dev:1.56.1` |
| Node.js | 22.20.0 |
| npm | 10.9.3 |
| Test runner | `node:test` из этого Node.js |
| Покрытие | c8 12.0.0, отчёт с неисполненными файлами (`--all`) |
| Браузер | Playwright 1.56.1, headless Chromium из образа |

Проверка библиотеки интерфейса остаётся отдельной: [ui/README.md](../ui/README.md). Эти команды не вызывают `tools/factorio-catalog` и не пересобирают `data/factorio`.

## Если Docker не установлен

Скрипт сам ничего не устанавливает.

- macOS: [Docker Desktop](https://docs.docker.com/desktop/setup/install/mac-install/). После установки запустите приложение и дождитесь демона.
- Windows: [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/). Команды `./dev/f-logic` рассчитаны на `sh` (WSL или Git Bash).
- Linux: [Docker Engine](https://docs.docker.com/engine/install/).

Проверка: `docker version`. Если команды `docker` нет или демон не отвечает, `./dev/f-logic` завершается с кодом 127 и ссылкой на этот файл.

## Команды

Из корня репозитория:

```sh
./dev/f-logic build
./dev/f-logic test
./dev/f-logic test:full
./dev/f-logic serve
./dev/f-logic verify
./dev/f-logic catalog
```

- `test` — только `test/unit`.
- `test:full` — `test/unit`, `test/browser`, отчёт c8 в `dev/artifacts/coverage/` (каталог в `.gitignore`). Когда появится `src/`, его `*.js` входят в тот же отчёт. `dev/sample/unexecuted.js` специально нигде не импортируется: в отчёте у него нулевые попадания, поэтому общий процент меньше 100%. Это образец контура, не код движка.
- `serve` публикует порт **только на 127.0.0.1**. Внутри контейнера процесс слушает `0.0.0.0`, иначе Docker Desktop не пробросит localhost-порт. Другой порт хоста: `F_LOGIC_PORT=4180 ./dev/f-logic serve`.
- `verify` заново собирает образ без кэша и проходит матрицу ENV-1…ENV-8. Порт этой проверки по умолчанию 4193 (`F_LOGIC_VERIFY_PORT`).
- `catalog` собирает производную таблицу Signal в `data/signal-catalog/2.1.24` из уже сохранённого снимка. Сырые файлы `data/factorio` не перезаписываются. Конечному пользователю готовая таблица нужна без Docker и без Factorio.

Начиная с пользовательской сверки 18.11.2026 `catalog` также передаёт `--chooser-review data/evidence/constant-combinator-review-2026-11-18/review.json`: это исправленный набор Space Age. Ручной запуск CLI без этого флага не применяет 185 удалений и пять добавлений; его нельзя выдавать за актуальный итог сверки. Base при применении этого файла не изменяется.

Процесс контейнера идёт от `uid`/`gid` текущего пользователя. Вход от root запрещён, чтобы bind mount не становился root-owned. Образ с тестами пишет отчёты в смонтированный каталог; после `--rm` файлы остаются на хосте.

Локальные адреса dev-server:

- http://127.0.0.1:4173/
- http://127.0.0.1:4173/factorio-ide/
- http://127.0.0.1:4173/ui/
- http://127.0.0.1:4173/ui/workspace.html
- http://127.0.0.1:4173/pages/event/
- http://127.0.0.1:4173/pages/circuit/
- http://127.0.0.1:4173/pages/debugger/
- http://127.0.0.1:4173/pages/networks/
- http://127.0.0.1:4173/pages/configure/
- http://127.0.0.1:4173/pages/project/
- http://127.0.0.1:4173/factorio-ide/pages/event/
- http://127.0.0.1:4173/factorio-ide/pages/circuit/
- http://127.0.0.1:4173/factorio-ide/pages/debugger/
- http://127.0.0.1:4173/factorio-ide/pages/networks/
- http://127.0.0.1:4173/factorio-ide/pages/configure/
- http://127.0.0.1:4173/factorio-ide/pages/project/
- http://127.0.0.1:4173/dev/smoke/

`dev/smoke/` — служебная страница контура, не приложение. Каталог `ui/` — готовая статическая библиотека. Прикладного сервера нет: dev-server только читает файлы.

Lockfile обновляется так же без Node.js на хосте:

```sh
./dev/f-logic lock
```

Если `verify` прерван, удалите оставшийся `test/unit/intentional-fail.test.mjs`: это временная ложная проверка, её не должно быть в дереве.
