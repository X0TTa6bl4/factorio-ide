/** Формат документа конфигурации. Текст не исполняется: только токены и дерево разбора. */

import { parseConfiguration, tokenize } from "./config-grammar.js";
import { fieldList, selectorOperation } from "./config-schema.js";

const BLOCKING = new Set(["syntax", "forbidden-effect"]);

export function formatConfiguration(text, caret = { start: 0, end: 0 }) {
  const source = typeof text === "string" ? text : "";
  const place = clampCaret(source, caret);
  if (typeof text !== "string") {
    return { text: source, changed: false, reason: "syntax", caret: place };
  }
  const parsed = parseConfiguration(source);
  const blocking = parsed.diagnostics.find((item) => BLOCKING.has(item.code));
  if (blocking) {
    return { text: source, changed: false, reason: blocking.code, caret: place };
  }
  const tokens = tokenize(source);
  const printer = new Printer();
  printDocument(printer, source, tokens, parsed.statements);
  const next = printer.out;
  if (next === source) {
    return { text: source, changed: false, reason: "unchanged", caret: place };
  }
  const mappedStart = mapOffset(printer.segments, place.start, source.length, next.length);
  const mappedEnd = mapOffset(printer.segments, place.end, source.length, next.length);
  return {
    text: next,
    changed: true,
    reason: null,
    caret: {
      start: Math.min(mappedStart, mappedEnd),
      end: Math.max(mappedStart, mappedEnd),
    },
  };
}

function printDocument(printer, text, tokens, statements) {
  if (statements.length === 0) {
    const comments = tokens.filter((token) => token.type === "comment");
    comments.forEach((comment, index) => {
      if (index > 0) printer.write("\n");
      emitSlice(printer, text, comment.start, comment.end);
    });
    if (printer.out) printer.write("\n");
    return;
  }
  const { items, endComments } = bindPieces(text, tokens, 0, text.length, statements);
  items.forEach((item, index) => {
    if (index > 0) printer.write("\n");
    writeComments(printer, text, item.leading, 0, false);
    printStatement(printer, text, tokens, item.piece);
    writeComments(printer, text, item.trailing, 0, true);
    printer.write("\n");
  });
  writeComments(printer, text, endComments, 0, false);
}

function printStatement(printer, text, tokens, statement) {
  if (statement.type === "wire") {
    printer.write("wire ");
    emitSlice(printer, text, statement.nameRange.start, statement.nameRange.end);
    printer.write(" ");
    const node = braced(text, statement);
    printObject(printer, text, tokens, node, 1, "wire", null, false, commentsBetween(tokens, statement.nameRange.end, node.range.start));
    return;
  }
  if (statement.type === "peers") {
    printer.write("peers ");
    const name = identBetween(tokens, statement.name, statement.range.start, statement.range.end);
    if (name) emitSlice(printer, text, name.start, name.end);
    else printer.write(statement.name);
    printer.write(" ");
    const node = braced(text, statement);
    printObject(printer, text, tokens, node, 1, "peers", null, false, commentsBetween(tokens, name?.end ?? statement.range.start, node.range.start));
    return;
  }
  if (statement.type === "group") {
    printer.write("group ");
    const name = identBetween(tokens, statement.name, statement.range.start, statement.object.range.start);
    if (name) emitSlice(printer, text, name.start, name.end);
    else printer.write(statement.name);
    printer.write(" = new Constant.Group(");
    printCallBody(printer, text, tokens, statement, "Constant.Group");
    return;
  }
  if (statement.type === "device" && statement.form === "legacy") {
    emitSlice(printer, text, statement.range.start, statement.range.start + statement.kind.length);
    printer.write(" ");
    const name = identBetween(tokens, statement.name, statement.range.start, statement.object.range.start);
    if (name) emitSlice(printer, text, name.start, name.end);
    else printer.write(statement.name);
    printer.write(` = new ${statement.className}(`);
    printCallBody(printer, text, tokens, statement, statement.className);
    return;
  }
  if (statement.type === "device") {
    emitSlice(printer, text, statement.range.start, statement.range.start + statement.className.length);
    if (statement.name) {
      printer.write(" ");
      const name = identBetween(tokens, statement.name, statement.range.start, statement.object.range.start);
      if (name) emitSlice(printer, text, name.start, name.end);
      else printer.write(statement.name);
    }
    printer.write("(");
    printCallBody(printer, text, tokens, statement, statement.className);
  }
}

function printCallBody(printer, text, tokens, statement, owner) {
  const node = statement.object;
  const prelude = commentsBetween(tokens, statement.range.start, node.range.start);
  printObject(printer, text, tokens, node, 1, owner, null, false, prelude);
  const tail = commentsBetween(tokens, node.range.end, statement.range.end);
  printer.write(")");
  writeComments(printer, text, tail, 0, true);
}

function printObject(printer, text, tokens, node, level, owner, key, element, prelude = []) {
  const open = node.range.start;
  const close = node.range.end - 1;
  const operation = !key && owner === "Selector" ? selectorOperation(text.slice(open, node.range.end)) : null;
  const names = fieldList(owner, key, { element, operation });
  const { items, endComments } = bindPieces(text, tokens, open + 1, close, node.fields);
  for (const item of items) absorbKeyComments(text, tokens, item);
  const ordered = orderFields(items, names);
  const hasBody = ordered.length > 0 || endComments.length > 0 || prelude.length > 0;
  const compact = key != null && flatFields(ordered) && !hasComment(prelude, ordered, endComments);
  printer.emit("{", open, open + 1);
  if (!hasBody) {
    printer.emit("}", close, close + 1);
    return;
  }
  if (compact) {
    printer.write(" ");
    ordered.forEach((item, index) => {
      if (index > 0) printer.write(", ");
      printField(printer, text, tokens, item, level, owner);
    });
    printer.write(" ");
    printer.emit("}", close, close + 1);
    return;
  }
  printer.write("\n");
  writeComments(printer, text, prelude, level, false);
  ordered.forEach((item, index) => {
    writeComments(printer, text, item.leading, level, false);
    printer.write("\t".repeat(level));
    printField(printer, text, tokens, item, level, owner);
    if (index < ordered.length - 1) printer.write(",");
    writeComments(printer, text, item.trailing, level, true);
    printer.write("\n");
  });
  writeComments(printer, text, endComments, level, false);
  printer.write("\t".repeat(Math.max(0, level - 1)));
  printer.emit("}", close, close + 1);
}

function printArray(printer, text, tokens, node, level, owner, key) {
  const open = node.range.start;
  const close = node.range.end - 1;
  const { items, endComments } = bindPieces(text, tokens, open + 1, close, node.items);
  printer.emit("[", open, open + 1);
  if (items.length === 0 && endComments.length === 0) {
    printer.emit("]", close, close + 1);
    return;
  }
  // Один элемент без комментария остаётся на строке скобки. Многострочное тело получает отступ массива, `]` дописывается сразу за ним.
  if (items.length === 1 && !hasComment([], items, endComments)) {
    printValue(printer, text, tokens, items[0].piece, level, owner, key, true);
    printer.emit("]", close, close + 1);
    return;
  }
  printer.write("\n");
  items.forEach((item, index) => {
    writeComments(printer, text, item.leading, level, false);
    printer.write("\t".repeat(level));
    printValue(printer, text, tokens, item.piece, level + 1, owner, key, true);
    if (index < items.length - 1) printer.write(",");
    writeComments(printer, text, item.trailing, level, true);
    printer.write("\n");
  });
  writeComments(printer, text, endComments, level, false);
  printer.write("\t".repeat(Math.max(0, level - 1)));
  printer.emit("]", close, close + 1);
}

function printField(printer, text, tokens, item, level, owner) {
  const nameStart = item.piece.range.start;
  printer.emit(item.piece.name, nameStart, nameStart + item.piece.name.length);
  printer.write(": ");
  printValue(printer, text, tokens, item.piece.value, level + 1, owner, item.piece.name, false);
}

function flatFields(items) {
  return items.length > 0 && items.every((item) => {
    const value = item.piece.value;
    return value && value.type !== "object" && value.type !== "array";
  });
}

function hasComment(prelude, items, endComments) {
  if (prelude.length > 0 || endComments.length > 0) return true;
  return items.some((item) => item.leading.length > 0 || item.trailing.length > 0);
}

function printValue(printer, text, tokens, node, level, owner, key, element) {
  if (!node) return;
  if (node.type === "object") {
    printObject(printer, text, tokens, node, level, owner, key, element);
    return;
  }
  if (node.type === "array") {
    printArray(printer, text, tokens, node, level, owner, key);
    return;
  }
  printAtomic(printer, text, tokens, node);
}

function printAtomic(printer, text, tokens, node) {
  const commented = commentsBetween(tokens, node.range.start, node.range.end).length > 0;
  if (commented || node.type === "invalid" || node.type !== "path") {
    emitSlice(printer, text, node.range.start, node.range.end);
    return;
  }
  let printed = node.parts.join(".");
  if (node.quality?.name) printed += `.withQuality(Quality.${node.quality.name})`;
  printer.emit(printed, node.range.start, node.range.end);
}

function writeComments(printer, text, comments, level, trailing) {
  if (!comments?.length) return;
  if (trailing) {
    printer.write(" ");
    comments.forEach((comment, index) => {
      if (index > 0) printer.write(" ");
      emitSlice(printer, text, comment.start, comment.end);
    });
    return;
  }
  const pad = "\t".repeat(level);
  for (const comment of comments) {
    printer.write(pad);
    emitSlice(printer, text, comment.start, comment.end);
    printer.write("\n");
  }
}

function bindPieces(text, tokens, from, to, pieces) {
  const items = [...pieces]
    .sort((left, right) => left.range.start - right.range.start)
    .map((piece) => ({ piece, leading: [], trailing: [] }));
  const endComments = [];
  let cursor = from;
  items.forEach((item, index) => {
    const before = commentsBetween(tokens, cursor, item.piece.range.start);
    if (index === 0) item.leading.push(...before);
    else {
      const split = splitTrailing(text, before, items[index - 1].piece.range.end);
      items[index - 1].trailing.push(...split.trailing);
      item.leading.push(...split.rest);
    }
    cursor = item.piece.range.end;
  });
  const after = commentsBetween(tokens, cursor, to);
  if (items.length === 0) endComments.push(...after);
  else {
    const split = splitTrailing(text, after, items.at(-1).piece.range.end);
    items.at(-1).trailing.push(...split.trailing);
    endComments.push(...split.rest);
  }
  return { items, endComments };
}

function absorbKeyComments(text, tokens, item) {
  const field = item.piece;
  if (!field?.value || typeof field.name !== "string") return;
  const nameEnd = field.range.start + field.name.length;
  const inner = commentsBetween(tokens, nameEnd, field.value.range.start);
  const split = splitTrailing(text, inner, nameEnd);
  item.trailing.push(...split.trailing);
  item.leading.push(...split.rest);
}

function splitTrailing(text, comments, ownerEnd) {
  const line = lineOf(text, ownerEnd > 0 ? ownerEnd - 1 : 0);
  const trailing = [];
  const rest = [];
  for (const comment of comments) {
    if (text.startsWith("//", comment.start) && lineOf(text, comment.start) === line) trailing.push(comment);
    else rest.push(comment);
  }
  return { trailing, rest };
}

function orderFields(items, names) {
  const rank = new Map(names.map((name, index) => [name, index]));
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftRank = rank.has(left.item.piece.name) ? rank.get(left.item.piece.name) : Number.POSITIVE_INFINITY;
      const rightRank = rank.has(right.item.piece.name) ? rank.get(right.item.piece.name) : Number.POSITIVE_INFINITY;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.index - right.index;
    })
    .map((entry) => entry.item);
}

function commentsBetween(tokens, from, to) {
  if (!(to > from)) return [];
  return tokens.filter((token) => token.type === "comment" && token.start >= from && token.start < to);
}

function identBetween(tokens, value, from, to) {
  return tokens.find((token) => token.type === "ident" && token.value === value && token.start >= from && token.start < to) ?? null;
}

function braced(text, statement) {
  const open = text.indexOf("{", statement.range.start);
  return {
    type: "object",
    fields: statement.fields ?? [],
    range: { start: open, end: statement.range.end },
  };
}

function emitSlice(printer, text, start, end) {
  printer.emit(text.slice(start, end), start, end);
}

function lineOf(text, offset) {
  let count = 0;
  const end = Math.min(Math.max(offset, 0), text.length);
  for (let index = 0; index < end; index += 1) if (text[index] === "\n") count += 1;
  return count;
}

function clampCaret(text, caret) {
  const start = clampOffset(text, caret?.start);
  const end = clampOffset(text, caret?.end ?? caret?.start);
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

function clampOffset(text, offset) {
  if (!Number.isInteger(offset)) return 0;
  return Math.min(text.length, Math.max(0, offset));
}

function mapOffset(segments, offset, oldLength, newLength) {
  if (!Number.isInteger(offset) || offset <= 0) return 0;
  if (offset >= oldLength) return newLength;
  let container = null;
  for (const segment of segments) {
    if (offset < segment.oldStart || offset > segment.oldEnd) continue;
    if (!container || segment.oldEnd - segment.oldStart < container.oldEnd - container.oldStart) container = segment;
  }
  if (container) {
    const oldSpan = container.oldEnd - container.oldStart;
    const newSpan = container.newEnd - container.newStart;
    if (oldSpan <= 0) return container.newStart;
    const pos = container.newStart + Math.round(((offset - container.oldStart) / oldSpan) * newSpan);
    return Math.min(container.newEnd, Math.max(container.newStart, pos));
  }
  let next = null;
  for (const segment of segments) {
    if (segment.oldStart >= offset && (!next || segment.oldStart < next.oldStart)) next = segment;
  }
  return next ? next.newStart : newLength;
}

class Printer {
  constructor() {
    this.out = "";
    this.segments = [];
  }

  write(chunk) {
    this.out += chunk;
  }

  emit(chunk, oldStart, oldEnd) {
    const newStart = this.out.length;
    this.out += chunk;
    if (Number.isInteger(oldStart) && Number.isInteger(oldEnd) && oldEnd >= oldStart) {
      this.segments.push({ oldStart, oldEnd, newStart, newEnd: this.out.length });
    }
  }
}
