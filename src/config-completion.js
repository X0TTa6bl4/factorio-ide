/** Контекст автодополнения по курсору. Неполный текст допустим; разбор не исполняет документ. */

import { tokenize } from "./config-grammar.js";
import { DEVICE_FIELDS, PEER_FIELDS, schemaFor, elementSchema, selectorFieldList, selectorOperation } from "./config-schema.js";

const CALL_TYPES = new Set(["Arithmetic", "Constant", "Decider", "Selector"]);
const LEGACY = new Map([
  ["arithmetic", "Arithmetic"],
  ["decider", "Decider"],
  ["constant", "Constant"],
  ["selector", "Selector"],
  ["event", "EventCombinator"],
  ["lamp", "Lamp"],
  ["storage", "Storage"],
  ["station", "Station"],
  ["train", "Train"],
]);
const PORTS = new Map([
  ["red_input", "red"],
  ["red_output", "red"],
  ["green_input", "green"],
  ["green_output", "green"],
]);
const BOOLEAN_KEYS = new Set([
  "enabled", "red", "green", "every_tick", "input_changed", "active", "use_colors", "highest",
]);
const VALUE_KEYS = new Set([
  ...Object.values(DEVICE_FIELDS).flat(),
  "left_operand", "right_operand", "operation", "logic", "signal", "constant", "receiver",
  "min", "max", "group", "multiplier", "sort", "compare", "quality", "source", "destination",
]);

export function completionContext(text, start, end = start) {
  const from = clamp(text, Math.min(start, end));
  const to = clamp(text, Math.max(start, end));
  const tokens = tokenize(text);
  if (insideOpaque(text, tokens, to)) return none(text, from, to);
  const span = pathAround(text, tokens, to);
  const walk = walkStructure(text, tokens, to, span);
  const context = decide(text, to, span, walk);
  return {
    ...context,
    ...splitPathQuery(context.query),
    selectionStart: from,
    selectionEnd: to,
  };
}

/** Уже введённый путь и текущий неполный сегмент. Точка на конце оставляет сегмент пустым. */
export function splitPathQuery(query) {
  const text = query ?? "";
  const boundary = text.endsWith(".");
  const parts = text ? text.split(".") : [];
  if (boundary) parts.pop();
  const pathSegment = boundary ? "" : (parts.pop() ?? "");
  const pathPrefix = parts.length ? `${parts.join(".")}.` : "";
  return { pathPrefix, pathSegment };
}

/** Следующий сегмент каждого пути. Подпись — этот сегмент, name — путь до него включительно. */
export function pathChildren(paths, query) {
  const { pathPrefix, pathSegment } = splitPathQuery(query);
  const prefix = pathPrefix ? pathPrefix.slice(0, -1).split(".") : [];
  const seen = new Map();
  for (const path of paths) {
    const segs = path.split(".");
    if (segs.length <= prefix.length) continue;
    if (prefix.some((part, index) => segs[index] !== part)) continue;
    const next = segs[prefix.length];
    if (!next.startsWith(pathSegment)) continue;
    const leaf = segs.length === prefix.length + 1;
    const name = segs.slice(0, prefix.length + 1).join(".");
    const current = seen.get(next);
    if (!current) {
      seen.set(next, { name, label: next, leaf });
    } else if (current.leaf && !leaf) {
      current.leaf = false;
      current.name = name;
    }
  }
  return [...seen.values()];
}

function none(text, from, to) {
  return {
    kind: "none",
    query: "",
    ...splitPathQuery(""),
    range: { start: to, end: to },
    caret: to,
    selectionStart: from,
    selectionEnd: to,
    color: null,
    owner: null,
    group: null,
    role: null,
    field: null,
    keys: null,
    mode: null,
    container: "none",
    options: null,
    nullable: false,
    signalContext: null,
    slice: "",
  };
}

function decide(text, caret, span, walk) {
  const query = span.query;
  const range = { start: span.start, end: span.end };
  const base = {
    query,
    range,
    caret,
    color: null,
    owner: walk.owner,
    group: null,
    role: null,
    field: walk.valueKey,
    keys: null,
    mode: walk.mode,
    options: null,
    nullable: false,
    signalContext: null,
    slice: text.slice(range.start, range.end),
    container: containerOf(walk),
  };
  if (walk.callee === "withQuality") {
    return { ...base, kind: "quality", field: "quality" };
  }
  if (walk.mode === "key" && !query.includes(".")) {
    const keys = keyList(text, walk).filter((name) => name.startsWith(query));
    return { ...base, kind: "key", keys, owner: walk.owner };
  }
  if (walk.mode === "value" && walk.valueKey) {
    const value = valueKind(text, walk, query, range);
    if (value) return { ...base, ...value };
  }
  const operation = operationFromQuery(query);
  if (operation && walk.mode !== "call-name" && walk.mode !== "legacy-name") {
    return { ...base, kind: "operation", owner: operation.owner, group: operation.group };
  }
  if ((query === "Quality" || query.startsWith("Quality.")) && walk.mode !== "call-name") {
    return { ...base, kind: "quality", field: "quality" };
  }
  if ((query === "Signal" || query.startsWith("Signal.")) && walk.mode !== "call-name") {
    const role = walk.owner ? signalRole(walk.owner, walk.frames, walk.valueKey) : "channel";
    return {
      ...base,
      kind: "signal",
      role,
      field: walk.valueKey ?? "signal",
      signalContext: signalContext(text, walk, role, range),
    };
  }
  if (walk.mode === "statement" || walk.mode === "after-new") {
    return { ...base, kind: "type", mode: walk.mode === "after-new" ? "new" : "call", owner: null };
  }
  return { ...base, kind: "none" };
}

function valueKind(text, walk, query, range) {
  const field = walk.valueKey;
  const owner = walk.owner;
  if (PORTS.has(field)) return { kind: "network", color: PORTS.get(field), field };
  if (field === "operation") {
    const fromPath = operationFromQuery(query);
    return { kind: "operation", owner: classOwner(owner) ?? fromPath?.owner ?? null, group: "Operation", field };
  }
  if (field === "logic") return { kind: "operation", owner: "Decider", group: "Logic", field };
  if (field === "sort") return { kind: "operation", owner: "Selector", group: "Sort", field };
  if (field === "compare") return { kind: "operation", owner: "Selector", group: "Compare", field };
  if (field === "quality") return { kind: "quality", field };
  if (field === "signal" || field === "return" || field === "destination") {
    const role = signalRole(owner, walk.frames, field);
    return { kind: "signal", role, field, signalContext: signalContext(text, walk, role, range) };
  }
  if (field === "source") return { kind: "source", field };
  if (field === "game_tick" || field === "day_tick") {
    return { kind: "signal", role: "channel", field, nullable: true, signalContext: null };
  }
  if (field === "receiver") return { kind: "peer", field };
  if (field === "group") return { kind: "group", field };
  if (BOOLEAN_KEYS.has(field)) return { kind: "boolean", field };
  if (field === "color_mode") return { kind: "literal", field, options: ["\"mapping\"", "\"components\"", "\"packed\""] };
  if (field === "mode") return { kind: "literal", field, options: ["\"read\""] };
  if (field === "left_operand" || field === "right_operand") return { kind: "literal", field, options: ["null"] };
  return null;
}

function keyList(text, walk) {
  const frame = [...walk.frames].reverse().find((item) => item.kind === "object");
  if (!frame) return [];
  let fields = frame.schema.fields;
  if (frame.schema.type === "device" && frame.owner === "Selector") {
    fields = selectorKeys(text, frame.start);
  }
  if (frame.schema.type === "operand") fields = operandKeys(frame);
  return fields.filter((name) => !frame.seen.has(name));
}

function selectorKeys(text, start) {
  const slice = text.slice(start, objectExtent(text, start));
  return selectorFieldList(selectorOperation(slice));
}

function operandKeys(frame) {
  const seen = frame.seen;
  if (seen.has("constant")) return ["constant"];
  if (seen.has("red") || seen.has("green") || seen.has("signal")) {
    return frame.schema.fields.filter((name) => name !== "constant");
  }
  return frame.schema.fields;
}

function signalRole(owner, frames, field) {
  const keys = frames.map((frame) => frame.key).filter(Boolean);
  if (field) keys.push(field);
  if (owner === "Arithmetic") return keys.includes("return") ? "arithmetic-return" : "arithmetic-operand";
  if (owner === "Decider" || owner === "Lamp") {
    if (keys.includes("when_true") || keys.includes("when_false")) return "decider-output";
    if (keys.includes("right_operand")) return "decider-right";
    if (owner === "Lamp") return "channel";
    return "decider-left";
  }
  return "channel";
}

function signalContext(text, walk, role, range) {
  if (role !== "arithmetic-return") return null;
  const frame = [...walk.frames].reverse().find((item) => item.schema?.type === "device");
  const from = frame?.start ?? 0;
  const to = frame ? objectExtent(text, frame.start) : text.length;
  return { eachOperands: countEach(text, from, to, range.start, range.end) };
}

function containerOf(walk) {
  const top = walk.frames.at(-1);
  if (top?.kind === "object" || top?.kind === "array" || top?.kind === "paren") return top.kind;
  return "none";
}

/** Текст структурной вставки, диапазон, каретка и нужно ли сразу открыть следующее меню. */
export function structuralInsertion(text, context, choice) {
  const name = choice?.name ?? "";
  const kind = choice?.kind;
  if (!context?.range || typeof name !== "string" || !name) return null;
  if (!within(text, context.range)) return null;
  if (kind === "type" && context.kind === "type") return classScaffold(text, context, name);
  if (kind === "key" && context.kind === "key") return fieldSlot(text, context, name);
  if (choice.leaf === false && pathKind(kind) && pathContext(kind, context)) return continuePath(text, context, name);
  if (choice.leaf !== false && valueContext(kind, context)) return advanceValue(text, context, name);
  return null;
}

/** `{` или `[` в пустом слоте `имя: |,` раскрывает вложенную структуру, запятая остаётся снаружи. */
export function nestAtCaret(text, caret, opener) {
  if ((opener !== "{" && opener !== "[") || text[caret - 1] !== opener) return null;
  if (completionContext(text, caret).kind === "none") return null;
  let index = caret;
  while (text[index] === " " || text[index] === "\t") index += 1;
  if (text[index] !== ",") return null;
  const indent = lineIndent(text, caret - 1);
  const inner = `${indent}\t`;
  const closer = opener === "{" ? "}" : "]";
  const body = `${opener}\n${inner}\n${indent}${closer},`;
  return {
    text: body,
    range: { start: caret - 1, end: index + 1 },
    caret: caret - 1 + `${opener}\n${inner}`.length,
    reopen: true,
  };
}

function classScaffold(text, context, name) {
  if (/^[ \t]*\(/u.test(text.slice(context.range.end))) return null;
  const indent = lineIndent(text, context.range.start);
  const head = context.mode === "new" || CALL_TYPES.has(name) ? name : `new ${name}`;
  const prefix = `${head}({\n${indent}\t`;
  return {
    text: `${prefix}\n${indent}})`,
    range: context.range,
    caret: context.range.start + prefix.length,
    reopen: true,
  };
}

function fieldSlot(text, context, name) {
  const tail = fieldTail(text, context.range.end);
  if (!tail.empty) {
    return {
      text: name,
      range: context.range,
      caret: context.range.start + name.length,
      reopen: false,
    };
  }
  const body = `${name}: ,`;
  return {
    text: body,
    range: { start: context.range.start, end: tail.end },
    caret: context.range.start + name.length + 2,
    reopen: true,
  };
}

function continuePath(text, context, name) {
  const dot = text[context.range.end] === "." || name.endsWith(".") ? "" : ".";
  const body = `${name}${dot}`;
  return {
    text: body,
    range: context.range,
    caret: context.range.start + body.length,
    reopen: true,
  };
}

function advanceValue(text, context, name) {
  if (context.container !== "object" && context.container !== "array") return null;
  const start = context.range.start;
  const end = valueTail(text, context.range.end);
  const indent = lineIndent(text, start);
  const line = `${name},\n${indent}`;
  const next = text[end];
  const crowded = next !== undefined && next !== "\n" && next !== "\r" && next !== "}" && next !== "]" && next !== ")";
  return {
    text: crowded ? `${line}\n${indent}` : line,
    range: { start, end },
    caret: start + line.length,
    reopen: true,
  };
}

function fieldTail(text, end) {
  let index = end;
  while (text[index] === " " || text[index] === "\t") index += 1;
  if (text[index] === ":") {
    index += 1;
    while (text[index] === " " || text[index] === "\t") index += 1;
    if (text[index] === ",") return { empty: true, end: index + 1 };
    if (boundary(text[index])) return { empty: true, end: index };
    return { empty: false, end };
  }
  if (text[index] === ",") return { empty: true, end: index + 1 };
  if (boundary(text[index])) return { empty: true, end };
  return { empty: false, end };
}

function valueTail(text, end) {
  let index = end;
  while (text[index] === " " || text[index] === "\t") index += 1;
  if (text[index] === ",") {
    index += 1;
    while (text[index] === " " || text[index] === "\t") index += 1;
  }
  return index;
}

function boundary(char) {
  return char === undefined || char === "\n" || char === "\r" || char === "}" || char === "]" || char === ")";
}

function lineIndent(text, offset) {
  const before = Math.max(0, offset);
  const lineStart = before === 0 ? 0 : text.lastIndexOf("\n", before - 1) + 1;
  return /^[ \t]*/u.exec(text.slice(lineStart, before))[0];
}

function pathKind(kind) {
  return kind === "signal" || kind === "operation" || kind === "quality" || kind === "source";
}

function pathContext(kind, context) {
  return valueContext(kind, context);
}

function valueContext(kind, context) {
  if (context.kind === kind) return true;
  return context.kind === "source" && (kind === "signal" || kind === "quality");
}

function within(text, range) {
  return range.start >= 0 && range.end <= text.length && range.start <= range.end;
}

function classOwner(owner) {
  if (owner === "Constant.Group") return null;
  return owner;
}

function operationFromQuery(query) {
  const match = /^(Arithmetic|Decider|Selector|Lamp)(?:\.(Operation|Logic|Sort|Compare))?/.exec(query);
  if (!match) return null;
  return { owner: match[1], group: match[2] ?? null };
}

function walkStructure(text, tokens, caret, span) {
  const frames = [];
  let mode = "statement";
  let owner = null;
  let pendingKey = null;
  let pendingLoose = null;
  let valueKey = null;
  let callee = null;
  const top = () => frames.at(-1) ?? null;

  for (const token of tokens) {
    if (token.start >= caret) break;
    if (span.end > span.start && token.start >= span.start) break;
    if (token.end > caret) break;
    if (token.type === "comment" || token.type === "string") continue;
    if (token.type === "{") {
      if (mode === "peers-name") {
        frames.push({
          kind: "object",
          owner: null,
          key: null,
          schema: { type: "peers", fields: PEER_FIELDS },
          seen: new Set(),
          start: token.start,
        });
        mode = "key";
        continue;
      }
      const parent = top();
      const key = parent?.kind === "array" ? parent.key : valueKey;
      const schema = parent?.kind === "array" ? elementSchema(owner, parent.key) : schemaFor(owner, key);
      frames.push({
        kind: "object",
        owner,
        key,
        schema,
        seen: new Set(),
        start: token.start,
      });
      mode = "key";
      pendingKey = null;
      valueKey = null;
      pendingLoose = null;
      continue;
    }
    if (token.type === "}") {
      frames.pop();
      const parent = top();
      mode = parent?.kind === "object" ? "key" : parent?.kind === "array" ? "value" : "statement";
      pendingKey = null;
      valueKey = null;
      continue;
    }
    if (token.type === "[") {
      frames.push({ kind: "array", owner, key: valueKey, schema: null, seen: new Set(), start: token.start });
      mode = "value";
      continue;
    }
    if (token.type === "]") {
      frames.pop();
      mode = top()?.kind === "object" ? "key" : "value";
      valueKey = null;
      continue;
    }
    if (token.type === "(") {
      frames.push({ kind: "paren", owner, key: valueKey, callee, schema: null, seen: new Set(), start: token.start });
      mode = "value";
      continue;
    }
    if (token.type === ")") {
      frames.pop();
      callee = null;
      mode = top()?.kind === "object" ? "key" : "statement";
      continue;
    }
    if (token.type === ",") {
      if (top()?.kind === "object") {
        mode = "key";
        pendingKey = null;
        valueKey = null;
      }
      continue;
    }
    if (token.type === ":") {
      const key = pendingKey ?? pendingLoose;
      if (key && (top()?.kind === "object" || pendingLoose)) {
        top()?.seen.add(key);
        valueKey = key;
        mode = "value";
      }
      pendingKey = null;
      pendingLoose = null;
      continue;
    }
    if (token.type === "=") {
      if (mode === "legacy-name") mode = "legacy-eq";
      continue;
    }
    if (token.type === ".") {
      if (mode === "after-class") mode = "after-dot";
      continue;
    }
    if (token.type !== "ident") continue;
    callee = token.value === "withQuality" ? "withQuality" : null;
    if (mode === "after-new") {
      owner = token.value;
      mode = "after-class";
      continue;
    }
    if (mode === "after-dot") {
      if (owner === "Constant" && token.value === "Group") owner = "Constant.Group";
      mode = "after-class";
      continue;
    }
    if (mode === "key" && top()?.kind === "object") {
      pendingKey = token.value;
      continue;
    }
    if (mode === "value" || mode === "call-name" || mode === "legacy-name" || mode === "peers-name" || mode === "after-class") {
      continue;
    }
    if (token.value === "new" && frames.length === 0 && (mode === "statement" || mode === "legacy-eq")) {
      mode = "after-new";
      continue;
    }
    if (frames.length > 0 || mode !== "statement") continue;
    if (CALL_TYPES.has(token.value)) {
      owner = token.value;
      mode = "call-name";
      continue;
    }
    if (LEGACY.has(token.value)) {
      owner = LEGACY.get(token.value);
      mode = "legacy-name";
      continue;
    }
    if (token.value === "peers") {
      mode = "peers-name";
      continue;
    }
    if (token.value === "group") {
      owner = "Constant.Group";
      mode = "legacy-name";
      continue;
    }
    if (VALUE_KEYS.has(token.value)) pendingLoose = token.value;
  }

  if (mode === "after-class" && top()?.kind === "paren") mode = "value";
  const openParen = [...frames].reverse().find((frame) => frame.kind === "paren");
  return {
    frames,
    mode,
    owner,
    valueKey,
    callee: openParen?.callee ?? null,
  };
}

function pathAround(text, tokens, caret) {
  let index = -1;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if ((token.type === "ident" || token.type === ".") && token.start < caret && caret <= token.end) index = i;
  }
  if (index < 0) return { start: caret, end: caret, query: "" };
  let startIndex = index;
  while (startIndex > 0) {
    const prev = tokens[startIndex - 1];
    const cur = tokens[startIndex];
    if (prev.end !== cur.start) break;
    const pair = `${prev.type}${cur.type}`;
    if (pair !== "ident." && pair !== ".ident") break;
    startIndex -= 1;
  }
  const start = tokens[startIndex].start;
  const end = tokens[index].end;
  return { start, end, query: text.slice(start, caret) };
}

function insideOpaque(text, tokens, caret) {
  return tokens.some((token) => {
    if (token.type === "string") {
      if (caret <= token.start || caret > token.end) return false;
      return token.closed === false || caret < token.end;
    }
    if (token.type !== "comment") return false;
    if (caret <= token.start || caret > token.end) return false;
    if (token.unclosed || text.startsWith("//", token.start)) return true;
    return caret < token.end;
  });
}

function countEach(text, from, to, skipStart, skipEnd) {
  const re = /Signal\.Meta\.signal_each/g;
  const slice = text.slice(from, to);
  let count = 0;
  for (const match of slice.matchAll(re)) {
    const abs = from + match.index;
    if (abs < skipEnd && abs + match[0].length > skipStart) continue;
    count += 1;
  }
  return count;
}

function objectExtent(text, start) {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return text.length;
}

function clamp(text, offset) {
  if (!Number.isFinite(offset)) return 0;
  return Math.min(text.length, Math.max(0, offset));
}
