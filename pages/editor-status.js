/** Краткая подача уже посчитанной диагностики. Повторной проверки схемы здесь нет. */

const ACTION = {
  syntax: "Исправьте синтаксис в этом месте.",
  "forbidden-effect": "Оставьте декларацию устройства или сети.",
  "unknown-path": "Замените путь на сигнал, качество или операцию из каталога.",
  "unknown-signal": "Замените сигнал на имя из каталога.",
  "unavailable-signal": "Выберите сигнал текущего профиля.",
  "unknown-quality": "Замените качество на значение из каталога.",
  "unavailable-quality": "Выберите качество текущего профиля.",
  "invalid-operation": "Замените операцию на константу этого комбинатора.",
  "foreign-operation": "Выберите операцию этого комбинатора.",
  "invalid-name": "Укажите сеть red_* или green_*.",
  "invalid-constant": "Замените значение целым числом.",
  "invalid-port": "Укажите сеть red_* или green_* либо null.",
  "wrong-color": "Подключите сеть того же цвета, что и порт.",
  "missing-network": "Объявите сеть или выберите существующую.",
  "invalid-operand": "Укажите сигнал, целое число или null.",
  "mixed-operand": "Оставьте либо число, либо сигнал.",
  "invalid-mask": "Поставьте true или false.",
  "invalid-signal": "Укажите обычный сигнал каталога.",
  "unsupported-mode": "Замените метасигнал на обычный сигнал или Each.",
  "duplicate-field": "Оставьте поле один раз.",
  "duplicate-device": "Дайте устройству другое имя.",
  "invalid-wire": "Оставьте у сети строковую подпись label.",
  "unknown-group": "Объявите группу или уберите ссылку.",
  "invalid-peers": "Укажите событийный блок этой схемы.",
  "unsupported-case": "Укажите объект группы.",
};

export function lineOf(text, offset) {
  const source = typeof text === "string" ? text : "";
  const index = Math.max(0, Math.min(offset, source.length));
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

export function plainMessage(value) {
  const raw = typeof value === "string" ? value : "";
  const line = raw.split("\n").find((part) => part.trim() && !/^\s*at\s+/.test(part)) ?? "";
  return line
    .replace(/\s+/g, " ")
    .replace(/ревизи\S*/gi, "")
    .replace(/\b(?:revision|id)\s*[:=]\s*\S+/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,:;])/g, "$1")
    .trim();
}

function located(range) {
  if (!range || !Number.isInteger(range.start) || !Number.isInteger(range.end) || range.end < range.start) return null;
  return { start: range.start, end: range.end };
}

function sentence(reason, action) {
  const head = /[.!?…]$/.test(reason) ? reason : `${reason}.`;
  if (!action || head.includes(action)) return head;
  return `${head} ${action}`;
}

export function presentDiagnostic(item, text) {
  const reason = plainMessage(item?.message) || "Проверка не прошла";
  const action = ACTION[item?.code] || "Исправьте это значение.";
  const range = located(item?.range);
  return {
    code: item?.code ?? "",
    field: item?.field ?? "",
    expected: item?.expected ?? "",
    sentence: sentence(reason, action),
    range,
    line: range ? lineOf(text, range.start) : null,
  };
}

export function countLabel(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11
    ? "ошибка"
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
      ? "ошибки"
      : "ошибок";
  return `${count} ${word}`;
}

export function statusView({
  text = "",
  dirty = false,
  checking = false,
  failed = false,
  playbackError = "",
  diagnostics = [],
} = {}) {
  if (dirty) {
    return { kind: "dirty", summary: "Изменено · требуется проверка", items: [], jump: false, list: false };
  }
  const items = diagnostics.map((item) => presentDiagnostic(item, text));
  if (checking && items.length === 0 && !playbackError) {
    return { kind: "checking", summary: "Проверка…", items, jump: false, list: false };
  }
  if (items.length === 0 && (failed || playbackError)) {
    const message = plainMessage(playbackError);
    const summary = failed
      ? `${message ? `${message}. ` : ""}Остановлено. Запустите снова после исправления.`
      : (message || "Шаг не выполнен");
    return { kind: "stopped", summary, items, jump: false, list: false };
  }
  if (items.length === 0) {
    return { kind: "ok", summary: "Код проверен", items, jump: false, list: false };
  }
  if (items.length === 1) {
    const item = items[0];
    const summary = item.line ? `Строка ${item.line}: ${item.sentence}` : item.sentence;
    return { kind: "error", summary, items, jump: Boolean(item.range), list: false };
  }
  return { kind: "errors", summary: countLabel(items.length), items, jump: false, list: true };
}
