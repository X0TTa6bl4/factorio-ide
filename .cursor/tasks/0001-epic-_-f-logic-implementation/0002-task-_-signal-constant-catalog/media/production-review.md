# Ручная сверка вкладки Production

Дата: 18.11.2026. Свидетельство — пользовательский [скриншот](constant-combinator-chooser-2026-11-18/02-production.png). Профиль: Space Age без сторонних модов по сообщению пользователя. Целевая stable: 2.1.24; номер сборки на самом кадре не показан. Эта сверка не подтверждает другие вкладки, профиль base или остальные качества.

При ручном чтении кадра видны **54**, а не 53 заполненные клетки. Результат прежнего автоматического подсчёта был приблизительным. Клетки перечислены по строкам сверху вниз и слева направо; пустой хвост строки не учитывается. Идентификаторы сопоставлены по узнаваемому значку и порядку исходного каталога. Игровой клиент в этой проверке не запускался.

| Строка сетки | Число | `item/name` в порядке клеток |
|---|---|---|
| 1 | 5 | `repair-pack`, `blueprint`, `deconstruction-planner`, `upgrade-planner`, `blueprint-book` |
| 2 | 10 | `boiler`, `steam-engine`, `solar-panel`, `accumulator`, `nuclear-reactor`, `heat-pipe`, `heat-exchanger`, `steam-turbine`, `fusion-reactor`, `fusion-generator` |
| 3 | 5 | `burner-mining-drill`, `electric-mining-drill`, `big-mining-drill`, `offshore-pump`, `pumpjack` |
| 4 | 5 | `stone-furnace`, `steel-furnace`, `electric-furnace`, `foundry`, `recycler` |
| 5 | 3 | `agricultural-tower`, `biochamber`, `captive-biter-spawner` |
| 6 | 10 | `assembling-machine-1`, `assembling-machine-2`, `assembling-machine-3`, `oil-refinery`, `chemical-plant`, `centrifuge`, `electromagnetic-plant`, `cryogenic-plant`, `lab`, `biolab` |
| 7 | 3 | `lightning-rod`, `lightning-collector`, `heating-tower` |
| 8 | 10 | `beacon`, `speed-module`, `speed-module-2`, `speed-module-3`, `efficiency-module`, `efficiency-module-2`, `efficiency-module-3`, `productivity-module`, `productivity-module-2`, `productivity-module-3` |
| 9 | 3 | `quality-module`, `quality-module-2`, `quality-module-3` |

Итог: 5 + 10 + 5 + 5 + 3 + 10 + 3 + 10 + 3 = 54. Состав и порядок соответствуют 54 текущим экспортам `Signal.Production.*` профиля Space Age. Оснований удалять один из них по прежнему числу 53 нет.

В кадре есть одна клетка биолаборатории (строка 6, столбец 10), что согласуется с более ранним наблюдением пользователя. Назначение `Signal.Production.biolab` предмету уже является принятым правилом; точный тип кнопки не извлечён из изображения и не представлен здесь как runtime-свидетельство.
