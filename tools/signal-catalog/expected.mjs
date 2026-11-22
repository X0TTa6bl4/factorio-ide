/** Закреплённый снимок 2.1.24. Расхождение с этими полями — смешение происхождения, не повод переписать таблицу. */

export const EXPECTED = {
  gameVersion: "2.1.24",
  archiveSha256: "c49b66cff90aceff87b30f2973af0df7f51712cb2ee3153e0169d9bed46a964f",
  builderSha256: "215cd581cd4d00e910df88849fa3e1d48cd85a135a4462cb7286787ed29d9063",
  loaderSha256: "81ab70ff5a828576c3ef6389e535ce48f0e1b282c5e5ad20ccd39050df4d82a8",
  counts: { base: 1218, "space-age": 2249 },
  removed: ["item/satellite", "recipe/satellite"],
};

export const TYPE_FILES = {
  item: "items.json",
  fluid: "fluids.json",
  virtual: "virtual-signals.json",
  entity: "entities.json",
  recipe: "recipes.json",
  "space-location": "space-locations.json",
  "asteroid-chunk": "asteroid-chunks.json",
  quality: "qualities.json",
};

export const PROFILES = ["base", "space-age"];

export const RECIPE_HIDE_RULE = {
  level: "documentation",
  source: "https://lua-api.factorio.com/2.1.24/prototypes/RecipePrototype.html#hide_from_signal_gui",
  applicationVersion: "2.1.24",
  text: "If left unset, this property will be determined automatically: If the recipe is not hidden, and no item, fluid, or virtual signal has the same icon as this recipe, this property will be set to false. It'll be true otherwise.",
  iconComparison: "Канонический JSON слоёв нескрытых item/fluid/virtual, порядок слоёв сохранён. Обычные рецепты обоих профилей сверены с runtime 2.1.24 в data/evidence/runtime-2.1.24-2026-11-18. Это не подтверждение всего меню.",
  runtimeEvidence: "data/evidence/runtime-2.1.24-2026-11-18/manifest.json",
};

export const SIGNAL_QUALITY_DEFAULT = {
  value: "normal",
  level: "documentation",
  source: "https://lua-api.factorio.com/2.1.24/concepts/SignalID.html",
  note: "У SignalID поле quality по умолчанию равно normal. Снимок не сообщает, принимает ли конкретный прототип качество.",
};

export const ASTEROID_SIGNAL_NOTE = "Четыре сигнала кусков сопоставлены с item по blueprint data/evidence/constant-combinator-asteroid-chunks-2026-11-18.blueprint.txt. blueprint.version 562954249961473 декодируется как 2.1.24, младшие 16 бит равны 1. В секции кусков поле type отсутствует; у entity-фильтров той же выгрузки type записан. По SignalID отсутствующий type означает item, поэтому путь получает предмет, а asteroid-chunk остаётся без пути с причиной chooser-blueprint-item. Снимок не содержит hide_from_signal_gui и item_signal_alias; эти поля не выведены из blueprint и не записаны как false. Пакеты и настройки видимости в blueprint нет. menuConfirmed не ставится: выгрузка не покрывает все вкладки.";

export const BIOLAB_SIGNAL_NOTE = "По наблюдению пользователя 18.11.2026 отдельного сигнала entity/biolab в меню постоянного комбинатора нет. Signal.Production.biolab назначен item/biolab. entity/biolab сохранена в учёте без публичного пути, причина chooser-observation-item-only. Версия, активные пакеты и настройки этого наблюдения не указаны. Это не извлечённый runtime-флаг скрытия и не подтверждение всего меню. В снимке обе записи hidden: false и лежат в production-machine.";

export const PROPOSAL = [
  "Имя из prototype.name: ведущий цифровой блок до дефиса переносится в конец, затем дефис заменяется подчёркиванием; регистр сохраняется. Суффиксы _item/_recipe и ветви Recipe/Entity не добавляются.",
  "Пока коллизия не разрешена, publicPath не назначается ни одной записи с общим candidatePath. Учётные строки сохраняются.",
  "Принято для бочек: предмет получает путь, recipe наполнения — .fill, recipe опустошения — .empty. Имена листьев взяты из действий Fill и Empty. Рецепт пустой бочки и скрытый recycling этим действием не становятся.",
  "Принято для захваченного улья: публичный путь только у item/captive-biter-spawner. entity/captive-biter-spawner хранится с причиной project-item-only.",
  "Принято для биолаборатории: публичный путь только у item/biolab по наблюдению пользователя от 18.11.2026. entity/biolab хранится с причиной chooser-observation-item-only. Версия наблюдения не указана.",
  "Принято для четырёх кусков астероида: публичный путь у item/metallic-asteroid-chunk, item/carbonic-asteroid-chunk, item/oxide-asteroid-chunk и item/promethium-asteroid-chunk. Парный asteroid-chunk хранится с причиной chooser-blueprint-item. hide_from_signal_gui и item_signal_alias из снимка не получены и не подставлены.",
  "Принято 18.11.2026: entity/1x2-remnants экспортируется как Signal.Environment.remnants_1x2. Исходный игровой name остаётся 1x2-remnants.",
].join(" ");
