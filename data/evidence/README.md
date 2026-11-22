# Свидетельства для каталога сигналов

Файлы здесь — ручные выгрузки из игры (blueprint, скриншоты, заметки), не сырой data stage.

| Файл | Назначение |
|------|------------|
| `constant-combinator-asteroid-chunks-2026-11-18.blueprint.txt` | Экспорт постоянного комбинатора: 4 куска (секция 1) и 16 астероидов entity (секция 2). |
| `constant-combinator-asteroid-chunks-2026-11-18.parsed.json` | Расшифровка blueprint для задачи 0002: куски → `item/…`. |
| [runtime-2.1.24-2026-11-18](runtime-2.1.24-2026-11-18/README.md) | Реальный headless-запуск обоих профилей в Docker: все ID, поля visibility/alias/defaults; графическое меню не подтверждает. |
| [constant-combinator-review-2026-11-18](constant-combinator-review-2026-11-18/README.md) | Возвращённый пользователем чертёж: 693 ordinary-сигнала по десяти вкладкам, 185 удалений и пять добавлений. |

Генератор может ссылаться на `parsed.json` как на `chooser-observation` с уровнем свидетельства «blueprint-export».
