/** Подсказки страницы сценария: только поддержанный API событийного блока. */

const API = [
  { name: "this.tick", label: "опубликованная граница" },
  { name: "this.nextTick", label: "следующая граница" },
  { name: "this.state", label: "состояние" },
  { name: "this.messages", label: "сообщения" },
  { name: "this.peers", label: "получатель" },
  { name: "this.readSignal", label: "чтение канала" },
  { name: "this.readSignals", label: "чтение входов" },
  { name: "this.setOutput", label: "удерживаемый выход" },
  { name: "this.clearOutput", label: "очистить выход" },
  { name: "this.pulse", label: "импульс" },
  { name: "this.wakeAt", label: "пробуждение" },
  { name: "this.cancelWake", label: "снять пробуждение" },
  { name: "this.send", label: "сообщение" },
  { name: "this.random", label: "ГСЧ модели" },
  { name: "init", label: "начальная граница" },
  { name: "main", label: "шаг" },
  { name: "EventCombinator", label: "класс сценария" },
];

export function eventCompletion(text, start, end = start) {
  const from = clamp(text, Math.min(start, end));
  const to = clamp(text, Math.max(start, end));
  const span = scanScript(text, to);
  if (span.opaque) {
    return {
      items: [],
      context: emptyContext(to, from),
      anchor: emptyAnchor(to, from),
    };
  }
  const items = API.filter((item) => matches(item.name, span.query));
  const range = { start: span.start, end: span.end };
  const context = {
    kind: "api",
    query: span.query,
    range,
    caret: to,
    selectionStart: from,
    selectionEnd: to,
    color: null,
    owner: null,
    field: null,
    role: null,
    slice: text.slice(range.start, range.end),
  };
  return {
    items,
    context,
    anchor: {
      caret: to,
      selectionStart: from,
      selectionEnd: to,
      slice: context.slice,
      kind: "api",
      color: null,
      owner: null,
      field: null,
      role: null,
      range,
    },
  };
}

function matches(name, query) {
  if (query === "") return true;
  if (name.startsWith(query)) return true;
  const member = name.startsWith("this.") ? name.slice(5) : name;
  return !query.startsWith("this") && member.startsWith(query);
}

function emptyContext(caret, from) {
  return {
    kind: "none",
    query: "",
    range: { start: caret, end: caret },
    caret,
    selectionStart: from,
    selectionEnd: caret,
    color: null,
    owner: null,
    field: null,
    role: null,
    slice: "",
  };
}

function emptyAnchor(caret, from) {
  return {
    caret,
    selectionStart: from,
    selectionEnd: caret,
    slice: "",
    kind: "none",
    color: null,
    owner: null,
    field: null,
    role: null,
    range: { start: caret, end: caret },
  };
}

function scanScript(text, caret) {
  let index = 0;
  let state = "code";
  let exprDepth = 0;
  let start = caret;
  let end = caret;
  while (index < caret) {
    if (state === "line") {
      if (text[index] === "\n") state = "code";
      index += 1;
      continue;
    }
    if (state === "block") {
      if (text.startsWith("*/", index)) {
        state = "code";
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }
    if (state === "single" || state === "double" || state === "template") {
      const quote = state === "single" ? "'" : state === "double" ? "\"" : "`";
      if (text[index] === "\\") {
        index += 2;
        continue;
      }
      if (text[index] === quote) state = "code";
      else if (state === "template" && text.startsWith("${", index)) {
        state = "expr";
        exprDepth = 1;
        index += 2;
        continue;
      } else if ((state === "single" || state === "double") && text[index] === "\n") state = "code";
      index += 1;
      continue;
    }
    if (text.startsWith("//", index)) {
      state = "line";
      index += 2;
      continue;
    }
    if (text.startsWith("/*", index)) {
      state = "block";
      index += 2;
      continue;
    }
    if (text[index] === "'") {
      state = "single";
      index += 1;
      continue;
    }
    if (text[index] === "\"") {
      state = "double";
      index += 1;
      continue;
    }
    if (text[index] === "`") {
      state = "template";
      index += 1;
      continue;
    }
    if (state === "expr") {
      if (text[index] === "{") exprDepth += 1;
      if (text[index] === "}") {
        exprDepth -= 1;
        if (exprDepth === 0) {
          state = "template";
          index += 1;
          continue;
        }
      }
    }
    if (isIdentStart(text[index])) {
      const ident = index;
      index += 1;
      while (index < text.length && isIdent(text[index])) index += 1;
      if (index >= caret) {
        start = ident;
        end = index;
        let cursor = ident;
        while (cursor > 0 && text[cursor - 1] === ".") {
          let prev = cursor - 1;
          while (prev > 0 && isIdent(text[prev - 1])) prev -= 1;
          if (prev === cursor - 1 || !isIdentStart(text[prev])) break;
          start = prev;
          cursor = prev;
        }
        break;
      }
      continue;
    }
    index += 1;
  }
  if (state !== "code" && state !== "expr") return { opaque: true, start: caret, end: caret, query: "" };
  if (start === caret && caret > 0 && text[caret - 1] === ".") {
    let cursor = caret;
    let path = caret;
    while (cursor > 0 && text[cursor - 1] === ".") {
      let prev = cursor - 1;
      while (prev > 0 && isIdent(text[prev - 1])) prev -= 1;
      if (prev === cursor - 1 || !isIdentStart(text[prev])) break;
      path = prev;
      cursor = prev;
    }
    if (path < caret) {
      start = path;
      end = caret;
    }
  }
  return { opaque: false, start, end, query: text.slice(start, caret) };
}

function isIdentStart(char) {
  return /[A-Za-z_$]/u.test(char ?? "");
}

function isIdent(char) {
  return /[A-Za-z0-9_$]/u.test(char ?? "");
}

function clamp(text, offset) {
  if (!Number.isFinite(offset)) return 0;
  return Math.min(text.length, Math.max(0, offset));
}
