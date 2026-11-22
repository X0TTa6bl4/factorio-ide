/** Подсветка редакторов. Текст остаётся в textarea; слой только показывает цвета. */

import { tokenize } from "../src/config-grammar.js";

const CONFIG_WORDS = new Set([
  "wire", "group", "peers", "arithmetic", "decider", "constant", "selector",
  "event", "lamp", "storage", "station", "train", "new", "true", "false", "null",
]);

const JS_WORDS = new Set([
  "export", "class", "extends", "function", "return", "if", "else", "for", "while",
  "do", "const", "let", "var", "new", "this", "true", "false", "null", "undefined",
  "break", "continue", "switch", "case", "default", "throw", "try", "catch", "finally",
  "import", "from", "of", "in", "instanceof", "typeof", "void", "async", "await", "static",
]);

function pushPart(parts, text, className) {
  if (!text) return;
  const last = parts.at(-1);
  if (last && last.className === className) last.text += text;
  else parts.push({ text, className });
}

export function paintConfiguration(text, diagnostics = []) {
  const tokens = tokenize(text);
  const parts = [];
  let cursor = 0;
  tokens.forEach((token, index) => {
    pushPart(parts, text.slice(cursor, token.start), "");
    pushPart(parts, text.slice(token.start, token.end), configurationClass(tokens, index));
    cursor = token.end;
  });
  pushPart(parts, text.slice(cursor), "");
  return markDiagnostics(parts, diagnostics, text.length);
}

function markDiagnostics(parts, diagnostics, length) {
  const intervals = [];
  const points = new Set();
  for (const item of diagnostics) {
    const start = clampOffset(item?.range?.start, length);
    const end = clampOffset(item?.range?.end ?? start, length);
    if (end > start) intervals.push([Math.min(start, end), Math.max(start, end)]);
    else points.add(start);
  }
  if (intervals.length === 0 && points.size === 0) return parts;
  for (const point of [...points]) {
    if (intervals.some(([start, end]) => point > start && point < end)) points.delete(point);
  }
  const out = [];
  let offset = 0;
  const emitPoint = (at) => {
    if (!points.has(at)) return;
    pushMarked(out, "", "err-point");
    points.delete(at);
  };
  for (const part of parts) {
    emitPoint(offset);
    if (!part.text) continue;
    const cuts = new Set([0, part.text.length]);
    for (const [start, end] of intervals) {
      if (start > offset && start < offset + part.text.length) cuts.add(start - offset);
      if (end > offset && end < offset + part.text.length) cuts.add(end - offset);
    }
    for (const point of points) {
      if (point > offset && point < offset + part.text.length) cuts.add(point - offset);
    }
    let previous = 0;
    for (const cut of [...cuts].sort((left, right) => left - right)) {
      if (cut <= previous) continue;
      emitPoint(offset + previous);
      const abs = offset + previous;
      const marked = intervals.some(([start, end]) => abs >= start && abs < end);
      const className = [part.className, marked ? "err" : ""].filter(Boolean).join(" ");
      pushMarked(out, part.text.slice(previous, cut), className);
      previous = cut;
    }
    offset += part.text.length;
  }
  emitPoint(offset);
  for (const point of [...points].sort((left, right) => left - right)) emitPoint(point);
  return out;
}

function clampOffset(value, length) {
  const number = Number.isInteger(value) ? value : 0;
  return Math.max(0, Math.min(length, number));
}

function pushMarked(parts, text, className) {
  if (!text && className !== "err-point") return;
  const last = parts.at(-1);
  if (text && last && last.className === className) {
    last.text += text;
    return;
  }
  parts.push({ text, className });
}

function configurationClass(tokens, index) {
  const token = tokens[index];
  if (token.type === "comment") return "cmt";
  if (token.type === "string") return "str";
  if (token.type === "number") return "num";
  if (token.type !== "ident") return "";
  if (tokens[index + 1]?.type === ":") return "prop";
  if (tokens[index - 1]?.type === ".") return "path";
  if (CONFIG_WORDS.has(token.value)) return "kw";
  if (/^[A-Z]/u.test(token.value)) return "type";
  return "";
}

export function paintJavaScript(text) {
  const parts = [];
  let index = 0;
  while (index < text.length) {
    const rest = text.slice(index);
    if (rest.startsWith("//")) {
      const end = text.indexOf("\n", index);
      const stop = end === -1 ? text.length : end;
      pushPart(parts, text.slice(index, stop), "cmt");
      index = stop;
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = text.indexOf("*/", index + 2);
      const stop = end === -1 ? text.length : end + 2;
      pushPart(parts, text.slice(index, stop), "cmt");
      index = stop;
      continue;
    }
    const quote = text[index];
    if (quote === "\"" || quote === "'" || quote === "`") {
      let cursor = index + 1;
      while (cursor < text.length) {
        if (text[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (text[cursor] === quote) {
          cursor += 1;
          break;
        }
        if (quote !== "`" && text[cursor] === "\n") break;
        cursor += 1;
      }
      pushPart(parts, text.slice(index, cursor), "str");
      index = cursor;
      continue;
    }
    if (/\s/u.test(text[index])) {
      let cursor = index + 1;
      while (cursor < text.length && /\s/u.test(text[cursor])) cursor += 1;
      pushPart(parts, text.slice(index, cursor), "");
      index = cursor;
      continue;
    }
    if (/\d/u.test(text[index])) {
      const number = /^\d+(?:\.\d+)?/u.exec(rest);
      pushPart(parts, number[0], "num");
      index += number[0].length;
      continue;
    }
    const ident = /^[A-Za-z_$][A-Za-z0-9_$]*/u.exec(rest);
    if (ident) {
      const word = ident[0];
      let className = "";
      if (JS_WORDS.has(word)) className = "kw";
      else if (/^\s*:/u.test(text.slice(index + word.length))) className = "prop";
      else if (text[index - 1] === ".") className = "path";
      else if (/^[A-Z]/u.test(word)) className = "type";
      pushPart(parts, word, className);
      index += word.length;
      continue;
    }
    pushPart(parts, text[index], "");
    index += 1;
  }
  return parts;
}

export function mountCodePaint(textarea, paint, gutter) {
  const editor = textarea.closest(".fl-editor");
  const sheet = document.createElement("div");
  sheet.className = "fl-editor__sheet";
  const layer = document.createElement("pre");
  layer.className = "fl-editor__paint";
  layer.setAttribute("aria-hidden", "true");
  editor.classList.add("fl-editor--paint");
  textarea.before(sheet);
  sheet.append(layer, textarea);

  let marks = [];
  const refresh = (diagnostics) => {
    if (Array.isArray(diagnostics)) marks = diagnostics;
    const parts = paint(textarea.value, marks);
    if (textarea.value.endsWith("\n")) parts.push({ text: "\n", className: "" });
    layer.replaceChildren(...parts.map((part) => {
      if (!part.className) return document.createTextNode(part.text);
      const span = document.createElement("span");
      span.className = part.className;
      span.textContent = part.text;
      return span;
    }));
    align();
  };
  // Координаты задаёт textarea. Жесты над номерами переводит в неё mountEditor.
  const align = () => {
    layer.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
    if (!gutter) return;
    gutter.scrollTop = textarea.scrollTop;
    gutter.scrollLeft = 0;
  };

  textarea.addEventListener("input", () => refresh());
  textarea.addEventListener("scroll", align, { passive: true });
  refresh();
  return refresh;
}
