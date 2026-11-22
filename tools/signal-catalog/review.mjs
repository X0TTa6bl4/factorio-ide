import { qualitiesDocument } from "./build.mjs";
import { compareText } from "./format.mjs";

function linesOf(list) {
  return list.length === 0 ? ["- нет"] : list;
}

export function renderReview(built) {
  const lines = [];
  const version = built.coverage.gameVersion;
  lines.push(`# Таблица Signal ${version}`, "");
  lines.push("Производные файлы собраны из одного снимка. Подписи и порядок не задают publicPath.");
  lines.push("Состав игрового меню не подтверждён клиентом: `menuConfirmed` остаётся false.");
  lines.push(`Разрешение коллизий имён: \`collisionsResolved\` = ${built.collisions.resolved}.`, "");
  const returned = built.profiles["space-age"].chooserReview;
  if (returned) {
    lines.push("## Возвращённая пользовательская сверка Space Age", "");
    lines.push(`Применён исправленный пользователем blueprint: ${returned.signals} ordinary-сигналов. Источник: ${returned.source}.`);
    lines.push("Удалённые из чертежа записи сохранены в исходном учёте с chooser-review-removed. Добавленные ключи получили отдельные публичные пути. Это ручная сверка; сам успешный импорт не является доказательством полного состава GUI во всех режимах.", "");
  }
  const rules = built.collisions.appliedRules ?? [];
  if (rules.length > 0) {
    lines.push("## Применённые правила", "");
    for (const rule of rules) lines.push(`- ${rule}`);
    lines.push("");
  }
  lines.push("## Учёт", "");
  for (const profile of ["base", "space-age"]) {
    const coverage = built.coverage.profiles[profile];
    lines.push(`### ${profile}`, "");
    lines.push(`- Учётных строк: ${coverage.rows}, входных ID: ${coverage.input}.`);
    lines.push(`- Экспортированных путей: ${coverage.exported}. Это не число кнопок меню.`);
    const reasons = Object.entries(coverage.excluded).sort((left, right) => compareText(left[0], right[0]));
    for (const [reason, count] of reasons) lines.push(`- Без пути, ${reason}: ${count}.`);
    lines.push(`- Неразрешённые подписи en/ru: ${coverage.unresolvedLabels.en}/${coverage.unresolvedLabels.ru}.`);
    const qualities = qualitiesDocument(built.profiles[profile]);
    lines.push(`- Обычные уровни качества: ${qualities.observedOrdinaryLevels.join(", ") || "нет"}.`);
    lines.push(`- Пропущенные уровни между наблюдаемыми: ${qualities.missingLevels.join(", ") || "нет"}.`, "");
  }
  lines.push("## Коллизии", "");
  lines.push(built.collisions.proposal, "");
  for (const profile of ["base", "space-age"]) {
    lines.push(`### ${profile}`, "");
    const items = built.collisions.profiles[profile].map((item) => {
      const ids = item.records.map((record) => record.prototypeId).join(", ");
      return `- \`${item.candidatePath}\`: ${ids}`;
    });
    lines.push(...linesOf(items), "");
  }
  if (built.collisions.signals) {
    lines.push("## Астероиды и биолаборатория", "");
    lines.push(built.collisions.signals.asteroidNote, "");
    lines.push(built.collisions.signals.biolabNote, "");
    for (const profile of ["base", "space-age"]) {
      lines.push(`### ${profile}`, "");
      const asteroids = built.collisions.signals.asteroids[profile] ?? [];
      const asteroidLines = asteroids.map((pair) => {
        const left = pair.left ? `${pair.left.prototypeId} → ${pair.left.publicPath ?? pair.left.pathReason}` : "нет item";
        const right = pair.right ? `${pair.right.prototypeId} → ${pair.right.publicPath ?? pair.right.pathReason}` : "нет asteroid-chunk";
        const hide = pair.right?.hideFromSignalGui?.status ?? "нет";
        const alias = pair.right?.itemSignalAlias?.status ?? "нет";
        return `- \`${pair.name}\`: ${left}; ${right}; hide ${hide}; alias ${alias}`;
      });
      lines.push(...linesOf(asteroidLines));
      const biolab = built.collisions.signals.biolab[profile];
      if (!biolab) lines.push("- biolab: нет", "");
      else {
        const left = biolab.left ? `${biolab.left.prototypeId} → ${biolab.left.publicPath ?? biolab.left.pathReason}` : "нет item";
        const right = biolab.right ? `${biolab.right.prototypeId} → ${biolab.right.publicPath ?? biolab.right.pathReason}` : "нет entity";
        lines.push(`- biolab: ${left}; ${right}`, "");
      }
    }
  }
  lines.push("## Имена без точечного доступа", "");
  for (const profile of ["base", "space-age"]) {
    lines.push(`### ${profile}`, "");
    const items = built.collisions.propertyAccess[profile].map((item) => (
      `- \`${item.prototypeId}\`: \`${item.rejectedPath}\`, ${item.kind}`
    ));
    lines.push(...linesOf(items), "");
  }
  lines.push("## Профили", "");
  lines.push(`Удалены в Space Age: ${built.profileDiff.removed.join(", ") || "нет"}.`);
  lines.push(`Добавлено ID: ${built.profileDiff.added.length}. Полный список — в profile-diff.json.`);
  lines.push(`Изменены общие ID: ${built.profileDiff.changed.length}.`, "");
  for (const item of built.profileDiff.changed) {
    lines.push(`- \`${item.prototypeId}\`: ${item.fields.join(", ")}`);
  }
  lines.push("", "## Предыдущая версия", "");
  lines.push(built.versionDiff.explanation, "");
  lines.push("## Экспортируемые пути", "");
  for (const profile of ["base", "space-age"]) {
    lines.push(`### ${profile}`, "");
    const rows = built.profiles[profile].rows.filter((row) => row.publicPath);
    const sections = new Map();
    for (const row of rows) {
      const list = sections.get(row.publicSection) ?? [];
      list.push(row);
      sections.set(row.publicSection, list);
    }
    for (const section of [...sections.keys()].sort(compareText)) {
      lines.push(`#### ${section}`, "");
      for (const row of sections.get(section)) {
        const channel = row.channel ? "channel" : row.role;
        lines.push(`- \`${row.publicPath}\` → \`${row.prototypeId}\` (${channel})`);
      }
      lines.push("");
    }
  }
  lines.push("## Что не утверждается", "");
  lines.push("- Точный состав меню сигналов. Для него нужен клиент той же версии и профиля.");
  lines.push("- `.fill` и `.empty` не являются именами прототипов Factorio и не выполняют крафт. Предметный токен от их чтения не меняется.");
  lines.push("- `project-item-only` у захваченного улья не является runtime-скрытием и не доказывает отсутствие сущности во вкладке врагов.");
  lines.push("- `chooser-observation-item-only` у биолаборатории — наблюдение пользователя без указанной версии и настроек. Оно не подтверждает весь chooser и не является флагом скрытия.");
  lines.push("- Отсутствующие `hide_from_signal_gui` и `item_signal_alias` не записаны как false или пустой alias. Это статус снимка, не ответ runtime.");
  lines.push("- Перевод через request_translation. Статус unresolved — не штатная подпись.");
  lines.push("- Отсутствующее hide_from_signal_gui не записано как false. Вывод для рецепта лежит в signalSelection и помечен documentation.");
  lines.push("- Применимость качества к каналу, если снимок её не содержит, остаётся unconfirmed.");
  lines.push("- Отсутствие PNG не удаляет сигнал. rocket-capacity по массе не вычисляется.", "");
  return `${lines.join("\n")}\n`;
}
