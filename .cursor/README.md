# Агентская структура f logic

Источник: локальный `kmut-ml/.cursor/skills`. Перенос выполнен 2026-11-09; источник не изменён.

Схема сохранена: `.cursor` содержит инструкции и скиллы; `.agents -> .cursor` даёт Codex доступ к тому же набору. Корневой `AGENTS.md` содержит общие правила для Codex, `.cursor/rules` — соответствующие правила Cursor. Скрипты теперь работают только с текущим проектом.

## Перенесено и адаптировано — 12 скиллов

| Скилл | Назначение |
|---|---|
| `repo-orientation-ru` | Поиск кода и выбор workflow |
| `workspace-preflight-ru` | Состояние проекта и Git |
| `task-workflow-ru` | Задачи, эпики, баги и fix-up; исходные шаблоны |
| `work-orchestrator-ru` | Выполнение порученной работы |
| `git-commit-ru` | Коммит, ветки, merge, pull и push |
| `ci-failure-fix` | Исправление провалов проверок |
| `thermo-nuclear-code-quality-review` | Исходный скилл структурного ревью |
| `layered-modules-architecture-ru` | Границы модели, движка, языка и UI |
| `module-contract-docs-ru` | Документация модулей и контрактов; исходный шаблон адаптирован |
| `wiki-module-docs-ru` | Wiki-документация; исходный шаблон адаптирован |
| `task-sdd-handoff-ru` | Спецификация и локальный PR/MR-черновик |
| `command-skill-authoring` | Создание и изменение скиллов / правил |

Основные процедуры адаптированы, а не скопированы дословно: убраны абсолютные пути, сервисные профили, роли Grok/Composer/Dispatch, обязательные переходы в другой чат и предположение, что `.cursor` — отдельный Git-корень. Режимы вызова исходных скиллов сохранены: для процедур с `disable-model-invocation: true` ограничение перенесено в `agents/openai.yaml` как `allow_implicit_invocation: false`; остальные доступны для автоматического выбора. Неподдержанный общий YAML-флаг удалён.

## Исключено — 7 скиллов

- `cliback-workerman-ru`, `kmut-zond-workerman-ru`, `pumpr-scenario-report` — конкретные сервисы другого workspace.
- `docker-testing-workflow-ru`, `docker-phpstan-workflow-ru` — PHPUnit/PHPStan через корпоративный Docker lab.
- `webback-endpoint-workflow-ru`, `swagger-docblock-l5-ru` — Laravel endpoints и PHP docblocks.

Для согласованного направления HTML/CSS/JS эти процедуры не нужны. При появлении соответствующего стека их можно перенести отдельно.

Не перенесены реальные задачи и счётчик источника, `.git`, MCP-конфигурация, аналитика, секреты, продуктовые symlink и пользовательские данные. Стек не устанавливался, приложение не создавалось.

Карта выбора workflow: [skills/repo-orientation-ru/skills.md](skills/repo-orientation-ru/skills.md).
