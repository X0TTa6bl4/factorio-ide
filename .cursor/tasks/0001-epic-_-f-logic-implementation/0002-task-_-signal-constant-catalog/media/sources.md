# Источники полной таблицы Signal

Проверено 16.11.2026. Это карта необходимых источников и ограничений, а не утверждение о скачивании всех дистрибутивов или выполненной игровой сверке.

## Версия и приоритет

[API релизов](https://factorio.com/api/latest-releases) сейчас возвращает stable alpha/expansion **2.1.24**, experimental **2.1.25**. Выбор версии — по [совместимости](../../../../docs/specs/compatibility.md). У страниц latest при проверке встречались разные заголовки версий; prototype-api.json показал application_version 2.1.24. Поэтому URL latest не фиксирует происхождение: сохранять содержимое, версию, дату и SHA-256, перед применением сравнивать с target.

Приоритет для значений: официальный дистрибутив и итоговые runtime-прототипы нужного профиля; затем официальные определения/схемы этой версии. Wiki — пояснения и проверочные примеры. Публичный путь Signal.* — решение проекта на основе игрового name; в Factorio нет готового справочника наших JS-констант.

## 1. Где брать сами записи

| Источник | Что даёт | Ограничения и применение |
|---|---|---|
| [Wube factorio-data](https://github.com/wube/factorio-data) | Официальные Lua data definitions, зависимости пакетов, создание/изменение прототипов | Брать tag/commit нужной версии, выполнять все data/data-updates/data-final-fixes активного профиля; grep одного item.lua недостаточно. Доступность tag 2.1.24 при просмотре не подтверждена: web-инструмент вернул Cache miss; ref/SHA проверить при исполнении |
| [Официальная загрузка](https://factorio.com/download) и [headless 2.1.24](https://factorio.com/get-download/2.1.24/headless/linux64) | Дистрибутив согласованной версии с data core/base и доступными официальными пакетами | Архив уже использовался для локального снимка; сейчас повторно не скачивался. Фиксировать фактический mod-list и версии, не считать demo или experimental эквивалентом stable |
| [Существующие JSON проекта](../../../../../data/factorio/2.1.24/README.md), [manifest](../../../../../data/factorio/2.1.24/manifest.json) | Уже извлечённые 8 типов, группы, en/ru label, признаки, параметры и описания иконок | 1218 base/2249 Space Age с technical/hidden; не готовый список меню. labelSource и ограничения engineValidation обязательны |
| [LuaPrototypes](https://lua-api.factorio.com/latest/classes/LuaPrototypes.html) | Итоговые dictionaries prototypes.item/fluid/entity/recipe/virtual_signal/quality/space_location/asteroid_chunk после обработки движком | Нужен реальный runtime подходящей версии и профиля; отдельный Lua loader не воспроизводит все C++-defaults |
| [LuaItemPrototype](https://lua-api.factorio.com/latest/classes/LuaItemPrototype.html), [LuaRecipePrototype](https://lua-api.factorio.com/latest/classes/LuaRecipePrototype.html) | Runtime-группы, подписи, признаки, stack_size/weight и другие итоговые поля | Проверять фактические поля нужной версии; не выдумывать несуществующий универсальный runtime-флаг видимости |

Профиль base: core+base. Полный Space Age — отдельный законченный набор пакетов из manifest, а не только добавленные записи. Локальные [build.py](../../../../../tools/factorio-catalog/build.py) и [load-data.lua](../../../../../tools/factorio-catalog/load-data.lua) — инструменты происхождения, не независимый игровой эталон.

## 2. Типы, разделы и правила выбора

| Источник | Поля/правила |
|---|---|
| [SignalID](https://lua-api.factorio.com/latest/concepts/SignalID.html), [SignalIDType](https://lua-api.factorio.com/latest/concepts/SignalIDType.html), [SignalFilter](https://lua-api.factorio.com/latest/concepts/SignalFilter.html) | Тип/name/quality, normal по умолчанию, восемь типов и правила фильтра; игровые defaults не разрешают неоднозначность имён JS |
| [PrototypeBase](https://lua-api.factorio.com/latest/prototypes/PrototypeBase.html) | name, localised_name, order и наследование |
| [ItemGroup](https://lua-api.factorio.com/latest/prototypes/ItemGroup.html), [ItemSubGroup](https://lua-api.factorio.com/latest/prototypes/ItemSubGroup.html) | Связь прототип→подгруппа→группа и порядок; реальное меню сигналов проверять отдельно от меню крафта |
| [ItemPrototype](https://lua-api.factorio.com/latest/prototypes/ItemPrototype.html), [VirtualSignalPrototype](https://lua-api.factorio.com/latest/prototypes/VirtualSignalPrototype.html) | Семейства предметов, flags/служебные признаки и определения виртуальных сигналов |
| [RecipePrototype.hide_from_signal_gui](https://lua-api.factorio.com/latest/prototypes/RecipePrototype.html#hide_from_signal_gui) | Значение может вычисляться автоматически по hidden и совпадению иконок с item/fluid/virtual. Отсутствующее поле не означает false |
| [QualityPrototype](https://lua-api.factorio.com/latest/prototypes/QualityPrototype.html) | Реальные name/level/связи качеств; не предполагать сплошную нумерацию и не путать качество канала с отдельным сигналом |
| [SpaceLocationPrototype](https://lua-api.factorio.com/latest/prototypes/SpaceLocationPrototype.html), [AsteroidChunkPrototype](https://lua-api.factorio.com/latest/prototypes/AsteroidChunkPrototype.html) | Остальные профильные типы сигналов и их метаданные |
| [Circuit network](https://wiki.factorio.com/Circuit_network), [Virtual signals](https://wiki.factorio.com/Virtual_signals) | Пояснения каналов, виртуальных сигналов, метасигналов и разделов. Вторая ссылка перенаправляет в Circuit network; Wiki не является исчерпывающим машинным списком текущей версии |

Для окончательного видимого набора: экспорт/проверка через клиент целевой игры. Если API не перечисляет точное содержимое chooser, приложить проверяемый список/скриншоты конкретного выбора и настройки профиля. Не выводить недоступность канала только из отсутствия одной иконки и не считать любой prototype обычным передаваемым сигналом.

## 3. Подписи и переводы

- Официальные файлы locale из той же установленной версии: core locale и locale каждого активного пакета, языки en/ru. Формат и размещение описаны в [Localisation](https://wiki.factorio.com/Tutorial:Localisation). Не предполагать, что GitHub-зеркало содержит весь комплект локализации.
- [LocalisedString](https://lua-api.factorio.com/latest/concepts/LocalisedString.html) — не всегда один ключ: есть вложенные выражения, параметры, fallback и наследование имени.
- [LuaPlayer.request_translation](https://lua-api.factorio.com/latest/classes/LuaPlayer.html#request_translation) и on_string_translated — штатное разрешение сложных строк. Требуется подключённый игрок/подходящий клиентский язык; headless без клиента не гарантирует перевод.
- Существующий labelSource сохранять; ID-fallback не выдавать за переведённое название. Подпись и publicName независимы: перевод не переименовывает Signal.*.

## 4. Иконки и профильные параметры

[IconData](https://lua-api.factorio.com/latest/types/IconData.html), icon/icons соответствующего Prototype — источник порядка слоёв, размера, tint, scale и shift. PNG берутся из полной установки той же версии; локальный headless-снимок сохранил 770 путей, но PNG нет. Путь __base__/... не является адресом браузера. В этой задаче достаточно описания/статуса; не загружать сам дистрибутив в репозиторий.

Для stack_size/weight использовать реальные ItemPrototype/runtime-значения. Rocket-capacity и поведение режима Selector требуют своего правила и эталона: одна масса не доказывает готовую формулу вместимости. Здесь сохраняются проверенные исходные параметры.

## 5. Что задаёт сам проект

[API](../../../../docs/specs/api.md) задаёт десять разделов, отдельный Signal.Meta, неизменяемую тройку канала и новое именование. Это источник правила Signal.Logistic.wooden_chest, а не Wiki. Имя берётся из prototype.name с заменой дефиса на подчёркивание; регистр сохраняется, переводы/сокращения/$ не применяются. Коллизии требуют явного решения, источники Factorio не задают наше пространство JS-имён.

## Ограничения этой проверки

HTML-справочники, stable API, Wiki и корень репозитория Wube просмотрены. Публичные API JSON: prototype-api.json доступен; runtime-api.json через web-инструмент не получен, а ручной versioned URL в прежней проверке был недоступен. При реализации получать согласованную документацию/JSON и проверять application_version, не подменять её другой версией из-за доступности latest.

Дистрибутив/графика повторно не скачивались, Lua/C++ и клиент игры не запускались. Точный игровой chooser и полная локализация на сегодня не подтверждены этим исследованием.

18.11.2026 blueprint `data/evidence/constant-combinator-asteroid-chunks-2026-11-18.blueprint.txt` сопоставляет четыре куска с `item`. Поле `blueprint.version` `562954249961473` декодируется как 2.1.24, младшие 16 бит равны 1. В секции кусков `type` отсутствует, у entity-фильтров `type` равен `entity`. Это свидетельство четырёх сигналов, не полный состав меню и не значения `hide_from_signal_gui`/`item_signal_alias`.

По решению 18.11.2026 ведущий цифровой блок до дефиса переносится в конец перед заменой дефисов: `1x2-remnants` → `remnants_1x2`, путь — `Signal.Environment.remnants_1x2`. Исходный игровой name сохраняется; коллизии после переноса также проверяются. Это правило нашего API, а не переименование прототипа Factorio.

## Уточнения к исполнению от 18.11.2026

- Имена действий бочек подтверждаются сохранёнными recipes.json: `recipe/water-barrel` имеет `localised_name[0] = recipe-name.fill-barrel`, «Fill Water barrel» / «Наполнить бочку (Вода)»; `recipe/empty-water-barrel` — `recipe-name.empty-filled-barrel`, «Empty Water barrel» / «Опустошить бочку (Вода)». Фторкетон использует те же шаблоны. `.fill`/`.empty` — выбранные имена вложенных констант нашего API по этим действиям; игровые ID остаются исходными.
- Для астероидов изучены [AsteroidChunkPrototype.hide_from_signal_gui](https://lua-api.factorio.com/latest/prototypes/AsteroidChunkPrototype.html#hide_from_signal_gui) и [LuaAsteroidChunkPrototype](https://lua-api.factorio.com/latest/classes/LuaAsteroidChunkPrototype.html#item_signal_alias): runtime предоставляет hide_from_signal_gui и item_signal_alias. Это основание проверить видимость/alias, а не утверждение, что у каждого текущего прототипа alias уже установлен. Страницы latest через web возвращали разные заголовки 2.1.17/2.1.20/2.1.21; результаты для целевой 2.1.24 требуют отдельного свидетельства.
- Blueprint четырёх кусков записан в `data/evidence`. Отдельного runtime-прогона `hide_from_signal_gui` и `item_signal_alias` и подтверждения полного chooser нет. Прежние 15 пар — кандидаты на коллизии по сырым записям, не доказательство 15 конфликтов видимых сигналов.

## Поиск эталона меню постоянного комбинатора, 18.11.2026

- [Официальный API релизов](https://factorio.com/api/latest-releases): stable alpha/expansion 2.1.24, experimental 2.1.25. Перед будущим исполнением повторить проверку, не подменять stable заголовком latest.
- [Constant combinator](https://wiki.factorio.com/Constant_combinator) описывает вывод выбранных сигналов и секции. [SignalID](https://lua-api.factorio.com/latest/concepts/SignalID.html) используется общим API сигнальных полей разных устройств. Это подтверждает формат/переиспользование каналов, но не даёт готовый полный список chooser нужного профиля.
- [Публикация автора полного набора для 2.0.77](https://forums.factorio.com/viewtopic.php?t=136017) содержит CSV/blueprint и способ выгрузки всех восьми множеств prototypes. Автор отдельно отмечает невидимые в GUI сигналы. Этот набор другой версии и другого охвата: использовать как исследовательский кандидат, не как эталон меню 2.1.24.
- [Документация автора Draftsman](https://factorio-draftsman.readthedocs.io/en/stable/reference/data/signals.html) описывает извлечение signals из data.raw; просмотренная страница показывает старую схему/версию. Это не подтверждённый список chooser целевой игры; новая зависимость не устанавливалась.
- [LuaLogisticSection.filters](https://lua-api.factorio.com/latest/classes/LuaLogisticSection.html#filters) позволяет прочитать уже записанные слоты постоянного комбинатора. Успешное чтение/запись слота не доказывает доступность сигнала через UI или полноту списка. При экспортировании выбранного набора сохранять охват всех вкладок и настройки.
- Готовый полный, подтверждённый список меню constant для base/Space Age 2.1.24 среди проверенных источников не найден. Метод выгрузки полного chooser одной готовой функцией API также не подтверждён. Фактическая клиентская сверка остаётся пунктом реализации/проверки задачи, а не результатом этого интернет-поиска.

18.11.2026 пользователь прислал десять скринов меню постоянного комбинатора и сообщил, что кроме Space Age модов нет. Они лежат в [constant-combinator-chooser-2026-11-18](constant-combinator-chooser-2026-11-18): `01-logistic`, `02-production`, `03-intermediate`, `04-space`, `05-combat`, `06-fluids`, `07-signals`, `08-enemies`, `09-environment`, `10-unsorted`. Порядок сверен по подсвеченной вкладке и содержимому. На кадрах видны космос, фторкетон и качества, поэтому это профиль Space Age. 18.11.2026 пользователь сообщил, что версия этих скринов — последняя. По [API релизов](https://factorio.com/api/latest-releases) в тот же день последняя стабильная — 2.1.24, экспериментальная — 2.1.25. Для проекта «последняя» означает стабильную 2.1.24. Номер 2.1.25 к кадрам не приписывается. Снимка чистой базы нет. Эти кадры не выставляют `menuConfirmed`. Счёт значков на кадрах совпал с экспортом таблицы для Logistic (73), Space (50) и Fluids (22). Вкладка Environment на кадре заканчивается пустыми клетками, а таблица экспортирует 264 сущности, включая 126 remnants, 32 corpse и 10 stump. Полный список открытых проблем — [problems.md](problems.md).
