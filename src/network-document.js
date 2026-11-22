/** Разбор подмножества документа сетей. Не исполняет текст и не обращается к DOM. */

import { compareText } from "./compare.js";

const KINDS = new Set(["constant", "wire"]);
const PORTS = new Map([
  ["red_input", "red"],
  ["green_input", "green"],
  ["red_output", "red"],
  ["green_output", "green"],
]);

export function parseNetworkName(name) {
  if (typeof name !== "string") return null;
  if (name === "red_new" || name === "green_new") return null;
  const match = /^(red|green)_([A-Za-z0-9_]+)$/.exec(name);
  if (!match) return null;
  return { color: match[1], suffix: match[2] };
}

export function nextNetworkName(color, names) {
  const used = new Set(names);
  let index = 1;
  let name = `${color}_${index}`;
  while (used.has(name)) {
    index += 1;
    name = `${color}_${index}`;
  }
  return name;
}

/** Как завершить введённое имя: служебное слово, уже известная сеть или новое имя своего цвета. */
export function networkFinishChoice(color, typed, known) {
  if ((color !== "red" && color !== "green") || typeof typed !== "string") return null;
  if (typed === `${color}_new`) return { choice: "new", name: typed };
  const parsed = parseNetworkName(typed);
  if (!parsed || parsed.color !== color) return null;
  if (known.has(typed)) return { choice: "network", name: typed };
  return { choice: "create", name: typed };
}

export function suggestionItems({ color, query = "", entries }) {
  const prefix = query;
  const ranked = entries
    .filter((entry) => entry.color === color && entry.name.startsWith(prefix))
    .sort((left, right) => {
      const exact = Number(right.name === prefix) - Number(left.name === prefix);
      if (exact !== 0) return exact;
      return (right.mru ?? 0) - (left.mru ?? 0) || compareText(left.name, right.name);
    });
  const items = ranked.map((entry) => ({
    kind: "network",
    name: entry.name,
    id: entry.id,
    label: "Сеть",
    mru: entry.mru,
  }));
  const service = `${color}_new`;
  if (service.startsWith(prefix)) {
    items.push({ kind: "new", name: service, label: "Новая сеть" });
  }
  if (prefix === "" || "null".startsWith(prefix)) {
    items.push({ kind: "null", name: "null", label: "Не подключено" });
  }
  return items;
}

export function spliceText(text, edits) {
  const ordered = [...edits].sort((left, right) => right.start - left.start);
  let next = text;
  for (const edit of ordered) {
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  }
  return next;
}

function syntaxIssue(message, token) {
  return {
    code: "syntax",
    message,
    device: null,
    field: null,
    range: { start: token?.start ?? 0, end: token?.end ?? 0 },
  };
}

function tokenize(text) {
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const rest = text.slice(index);
    if (rest.startsWith("//")) {
      const end = text.indexOf("\n", index);
      const stop = end === -1 ? text.length : end;
      tokens.push({ type: "comment", start: index, end: stop });
      index = stop;
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = text.indexOf("*/", index + 2);
      if (end === -1) {
        tokens.push({ type: "comment", start: index, end: text.length, unclosed: true });
        index = text.length;
      } else {
        tokens.push({ type: "comment", start: index, end: end + 2 });
        index = end + 2;
      }
      continue;
    }
    if (text[index] === '"') {
      let cursor = index + 1;
      let closed = false;
      while (cursor < text.length) {
        if (text[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (text[cursor] === '"') {
          closed = true;
          cursor += 1;
          break;
        }
        if (text[cursor] === "\n") break;
        cursor += 1;
      }
      tokens.push({
        type: "string",
        start: index,
        end: cursor,
        closed,
        value: text.slice(index + 1, closed ? cursor - 1 : cursor),
      });
      index = cursor;
      continue;
    }
    if (/\s/u.test(text[index])) {
      index += 1;
      continue;
    }
    if (text[index] === "{" || text[index] === "}" || text[index] === ":") {
      tokens.push({ type: text[index], start: index, end: index + 1 });
      index += 1;
      continue;
    }
    const number = /^-?\d+/.exec(rest);
    if (number && (text[index] === "-" || /\d/u.test(text[index]))) {
      tokens.push({ type: "number", start: index, end: index + number[0].length, value: number[0] });
      index += number[0].length;
      continue;
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (ident) {
      tokens.push({ type: "ident", start: index, end: index + ident[0].length, value: ident[0] });
      index += ident[0].length;
      continue;
    }
    tokens.push({ type: "junk", start: index, end: index + 1, value: text[index] });
    index += 1;
  }
  return tokens;
}

export function parseNetworkDocument(text) {
  const tokens = tokenize(text);
  const syntax = [];
  for (const token of tokens) {
    if (token.unclosed) syntax.push(syntaxIssue("Комментарий не закрыт", token));
    if (token.type === "string" && token.closed === false) {
      syntax.push(syntaxIssue("Строка не закрыта", token));
    }
    if (token.type === "junk") syntax.push(syntaxIssue("Недопустимый символ", token));
  }
  const source = tokens.filter((token) => token.type !== "comment");
  const devices = [];
  let cursor = 0;

  const peek = () => source[cursor] ?? null;
  const take = () => source[cursor++] ?? null;

  while (cursor < source.length && syntax.length === 0) {
    const kind = take();
    if (!kind || kind.type !== "ident" || !KINDS.has(kind.value)) {
      syntax.push(syntaxIssue("Ожидается constant или wire", kind));
      break;
    }
    const name = take();
    if (!name || name.type !== "ident") {
      syntax.push(syntaxIssue("У устройства нет имени", name ?? kind));
      break;
    }
    const open = take();
    if (!open || open.type !== "{") {
      syntax.push(syntaxIssue("Ожидается блок устройства", open ?? name));
      break;
    }
    const device = {
      kind: kind.value,
      name: name.value,
      range: { start: kind.start, end: name.end },
      ports: [],
      signals: [],
      labels: [],
      enabled: null,
    };
    let closed = false;
    while (cursor < source.length) {
      const token = peek();
      if (token.type === "}") {
        take();
        device.range.end = token.end;
        closed = true;
        break;
      }
      const field = take();
      if (!field || field.type !== "ident") {
        syntax.push(syntaxIssue("Ожидается поле устройства", field ?? token));
        break;
      }
      if (field.value === "signal") {
        const signalName = take();
        const amount = take();
        if (!signalName || signalName.type !== "ident" || !amount || amount.type !== "number") {
          syntax.push(syntaxIssue("Сигнал записывается как signal имя количество", field));
          break;
        }
        device.signals.push({
          name: signalName.value,
          raw: amount.value,
          range: { start: field.start, end: amount.end },
        });
        continue;
      }
      const colon = take();
      if (!colon || colon.type !== ":") {
        syntax.push(syntaxIssue("Ожидается двоеточие", colon ?? field));
        break;
      }
      const value = peek();
      if (!value || value.type === "}") {
        syntax.push(syntaxIssue("Ожидается значение поля", colon));
        break;
      }
      take();
      if (field.value === "enabled") {
        if (value.type !== "ident" || (value.value !== "true" && value.value !== "false")) {
          syntax.push(syntaxIssue("enabled принимает true или false", value));
          break;
        }
        device.enabled = {
          value: value.value === "true",
          range: { start: field.start, end: value.end },
        };
        continue;
      }
      if (field.value === "label") {
        if (value.type !== "string" || value.closed === false) {
          syntax.push(syntaxIssue("Подпись label должна быть строкой", value));
          break;
        }
        device.labels.push({
          value: value.value,
          range: { start: value.start, end: value.end },
        });
        continue;
      }
      if (!PORTS.has(field.value)) {
        syntax.push(syntaxIssue(`Неизвестное поле ${field.value}`, field));
        break;
      }
      let portKind = "invalid";
      let textValue = text.slice(value.start, value.end);
      if (value.type === "ident" && value.value === "null") portKind = "null";
      else if (value.type === "ident") portKind = "name";
      else if (value.type === "string") portKind = "string";
      device.ports.push({
        field: field.value,
        color: PORTS.get(field.value),
        kind: portKind,
        text: portKind === "name" || portKind === "null" ? value.value : textValue,
        range: { start: value.start, end: value.end },
      });
    }
    if (!closed && syntax.length === 0) {
      syntax.push(syntaxIssue("Блок устройства не закрыт", kind));
    }
    devices.push(device);
  }

  if (syntax.length > 0) {
    return { syntax, devices: [] };
  }
  return { syntax, devices };
}
