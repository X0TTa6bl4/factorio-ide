/** Грамматика конфигурации схемы. Текст не исполняется: нет eval, Function и произвольных вызовов. */

const STATEMENT_WORDS = new Set(["wire", "group", "peers", "arithmetic", "decider", "constant", "selector", "event", "lamp", "storage", "station", "train"]);
const KINDS = new Map([
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
const CALL_KINDS = new Map([
  ["Arithmetic", "arithmetic"],
  ["Constant", "constant"],
  ["Decider", "decider"],
  ["Selector", "selector"],
]);
const STATEMENT_STARTS = new Set([...STATEMENT_WORDS, ...CALL_KINDS.keys()]);

function issue(code, message, token, extra = {}) {
  return {
    code,
    message,
    field: extra.field ?? null,
    expected: extra.expected ?? null,
    received: extra.received ?? null,
    related: extra.related ?? [],
    range: { start: token?.start ?? 0, end: token?.end ?? 0 },
  };
}

export function tokenize(text) {
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
      const stop = end === -1 ? text.length : end + 2;
      tokens.push({ type: "comment", start: index, end: stop, unclosed: end === -1 });
      index = stop;
      continue;
    }
    if (/\s/u.test(text[index])) {
      index += 1;
      continue;
    }
    if (text[index] === '"') {
      let cursor = index + 1;
      let value = "";
      let closed = false;
      while (cursor < text.length) {
        const char = text[cursor];
        if (char === "\\") {
          const next = text[cursor + 1];
          if (next === undefined) break;
          value += next === "n" ? "\n" : next;
          cursor += 2;
          continue;
        }
        if (char === '"') {
          closed = true;
          cursor += 1;
          break;
        }
        if (char === "\n") break;
        value += char;
        cursor += 1;
      }
      tokens.push({ type: "string", start: index, end: cursor, value, closed });
      index = cursor;
      continue;
    }
    if ("{}[]():,.;".includes(text[index])) {
      tokens.push({ type: text[index], start: index, end: index + 1 });
      index += 1;
      continue;
    }
    if (text[index] === "=") {
      tokens.push({ type: "=", start: index, end: index + 1 });
      index += 1;
      continue;
    }
    if (text[index] === "-" && /\d/u.test(text[index + 1] ?? "")) {
      const number = /^-?\d+(?:\.\d+)?/.exec(rest);
      tokens.push(numberToken(index, number[0]));
      index += number[0].length;
      continue;
    }
    if (/\d/u.test(text[index])) {
      const number = /^-?\d+(?:\.\d+)?/.exec(rest);
      tokens.push(numberToken(index, number[0]));
      index += number[0].length;
      continue;
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (ident) {
      tokens.push({ type: "ident", start: index, end: index + ident[0].length, value: ident[0] });
      index += ident[0].length;
      continue;
    }
    const operator = /^[+\-*/%&|^!<>?]+/.exec(rest);
    tokens.push({
      type: operator ? "operator" : "junk",
      start: index,
      end: index + (operator ? operator[0].length : 1),
      value: operator ? operator[0] : text[index],
    });
    index += operator ? operator[0].length : 1;
  }
  return tokens;
}

function numberToken(start, raw) {
  const integer = /^-?\d+$/.test(raw);
  let value = null;
  if (integer && raw.length <= 16) {
    const number = Number(raw);
    if (Number.isSafeInteger(number)) value = number;
  }
  return {
    type: "number",
    start,
    end: start + raw.length,
    raw,
    integer: integer && value !== null,
    value,
  };
}

class Parser {
  constructor(text) {
    this.text = text;
    this.tokens = tokenize(text).filter((token) => token.type !== "comment");
    this.index = 0;
    this.diagnostics = [];
    this.statements = [];
  }

  peek() {
    return this.tokens[this.index] ?? null;
  }

  take() {
    const token = this.peek();
    if (token) this.index += 1;
    return token;
  }

  expect(type, value) {
    const token = this.peek();
    const typeOk = token && (type === "value" || token.type === type);
    const valueOk = value === undefined || token?.value === value;
    if (!typeOk || !valueOk) {
      this.diagnostics.push(issue(
        "syntax",
        value === undefined ? `Ожидался ${type}` : `Ожидалось ${value}`,
        token ?? { start: this.text.length, end: this.text.length },
        { expected: value ?? type },
      ));
      return null;
    }
    return this.take();
  }

  skipBroken() {
    let depth = 0;
    while (this.peek()) {
      const token = this.peek();
      if (depth === 0 && token.type === "ident" && STATEMENT_STARTS.has(token.value)) return;
      if (token.type === "{" || token.type === "(" || token.type === "[") depth += 1;
      if (token.type === "}" || token.type === ")" || token.type === "]") {
        depth = Math.max(0, depth - 1);
        this.take();
        if (depth === 0) return;
        continue;
      }
      this.take();
    }
  }

  parse() {
    for (const token of this.tokens) {
      if (token.type === "comment" && token.unclosed) {
        this.diagnostics.push(issue("syntax", "Комментарий не закрыт", token));
      }
      if (token.type === "string" && token.closed === false) {
        this.diagnostics.push(issue("syntax", "Строка не закрыта", token, { expected: "string" }));
      }
    }
    while (this.peek()?.type === ";") this.take();
    while (this.peek()) {
      const cursor = this.index;
      this.parseStatement();
      while (this.peek()?.type === ";") this.take();
      if (this.index === cursor) this.take();
    }
    return { statements: this.statements, diagnostics: this.diagnostics };
  }

  parseStatement() {
    const token = this.peek();
    if (!token) return;
    if (token.type === "operator" || token.type === "junk") {
      this.diagnostics.push(issue(
        "forbidden-effect",
        "Оператор или посторонний эффект не входит в грамматику конфигурации",
        token,
        { expected: "декларация конфигурации" },
      ));
      this.skipBroken();
      return;
    }
    if (token.type !== "ident") {
      this.diagnostics.push(issue("syntax", "Ожидалась декларация", token, { expected: "декларация" }));
      this.skipBroken();
      return;
    }
    if (token.value === "wire") {
      this.parseWire();
      return;
    }
    if (token.value === "group") {
      this.parseGroup();
      return;
    }
    if (token.value === "peers") {
      this.parsePeers();
      return;
    }
    if (KINDS.has(token.value)) {
      this.parseDevice();
      return;
    }
    if (this.looksLikeCall(token)) {
      this.parseCall();
      return;
    }
    const next = this.tokens[this.index + 1];
    if (next?.type === "(" || next?.type === "=") {
      this.diagnostics.push(issue(
        "forbidden-effect",
        next.type === "("
          ? "Вызов произвольной функции в конфигурации запрещён"
          : "Присваивание вне декларации устройства, группы или сети запрещено",
        token,
        { expected: "Arithmetic({...}) или декларация" },
      ));
      this.skipBroken();
      return;
    }
    this.diagnostics.push(issue("syntax", `Неизвестная декларация ${token.value}`, token));
    this.skipBroken();
  }

  parseWire() {
    const start = this.take();
    const name = this.expect("ident");
    if (!this.expect("{")) {
      this.skipBroken();
      return;
    }
    const fields = this.parseFields();
    const end = this.expect("}");
    if (!name) return;
    this.statements.push({
      type: "wire",
      name: name.value,
      nameRange: { start: name.start, end: name.end },
      fields,
      range: { start: start.start, end: end?.end ?? this.peek()?.start ?? this.text.length },
    });
  }

  parseGroup() {
    const start = this.take();
    const name = this.expect("ident");
    if (!this.expect("=") || !this.expect("ident", "new")) {
      this.skipBroken();
      return;
    }
    this.expect("ident", "Constant");
    this.expect(".");
    this.expect("ident", "Group");
    if (!this.expect("(")) {
      this.skipBroken();
      return;
    }
    const object = this.parseObject();
    const end = this.expect(")");
    if (!name || !object) return;
    this.statements.push({
      type: "group",
      name: name.value,
      object,
      range: { start: start.start, end: end?.end ?? object.range.end },
    });
  }

  parsePeers() {
    const start = this.take();
    const name = this.expect("ident");
    if (!this.expect("{")) {
      this.skipBroken();
      return;
    }
    const fields = this.parseFields();
    const end = this.expect("}");
    if (!name) return;
    this.statements.push({
      type: "peers",
      name: name.value,
      fields,
      range: { start: start.start, end: end?.end ?? this.text.length },
    });
  }

  looksLikeCall(token) {
    if (!CALL_KINDS.has(token.value)) return false;
    const next = this.tokens[this.index + 1];
    const after = this.tokens[this.index + 2];
    return next?.type === "(" || (next?.type === "ident" && after?.type === "(");
  }

  parseCall() {
    const className = this.take();
    const named = this.tokens[this.index]?.type === "ident" && this.tokens[this.index + 1]?.type === "("
      ? this.take()
      : null;
    if (!this.expect("(")) {
      this.skipBroken();
      return;
    }
    const object = this.parseObject();
    const end = this.expect(")");
    if (!object) return;
    this.statements.push({
      type: "device",
      form: "call",
      kind: CALL_KINDS.get(className.value),
      className: className.value,
      name: named?.value ?? null,
      object,
      range: { start: className.start, end: end?.end ?? object.range.end },
    });
  }

  parseDevice() {
    const kind = this.take();
    const name = this.expect("ident");
    if (!this.expect("=")) {
      this.skipBroken();
      return;
    }
    const created = this.expect("ident", "new");
    if (!created) {
      this.diagnostics.push(issue(
        "forbidden-effect",
        "В записи «вид имя =» ожидается new Класс({...})",
        this.peek() ?? kind,
        { expected: `new ${KINDS.get(kind.value)}({...})` },
      ));
      this.skipBroken();
      return;
    }
    const className = this.expect("ident");
    if (!this.expect("(")) {
      this.skipBroken();
      return;
    }
    const object = this.parseObject();
    const end = this.expect(")");
    if (!name || !className || !object) return;
    this.statements.push({
      type: "device",
      form: "legacy",
      kind: kind.value,
      className: className.value,
      name: name.value,
      object,
      range: { start: kind.start, end: end?.end ?? object.range.end },
    });
  }

  parseObject() {
    const start = this.expect("{");
    if (!start) return null;
    const fields = this.parseFields();
    const end = this.expect("}");
    return {
      type: "object",
      fields,
      range: { start: start.start, end: end?.end ?? start.end },
    };
  }

  parseArray() {
    const start = this.expect("[");
    if (!start) return null;
    const items = [];
    while (this.peek() && this.peek().type !== "]") {
      if (this.peek().type === ",") {
        this.take();
        continue;
      }
      const value = this.parseValue();
      if (!value) break;
      items.push(value);
      if (this.peek()?.type === ",") this.take();
    }
    const end = this.expect("]");
    return {
      type: "array",
      items,
      range: { start: start.start, end: end?.end ?? start.end },
    };
  }

  parseFields() {
    const fields = [];
    while (this.peek() && this.peek().type !== "}" && this.peek().type !== "]") {
      if (this.peek().type === ",") {
        this.take();
        continue;
      }
      if (this.peek().type !== "ident") break;
      const name = this.take();
      if (!this.expect(":")) break;
      const value = this.parseValue();
      if (!value) break;
      fields.push({
        name: name.value,
        range: { start: name.start, end: value.range.end },
        value,
      });
      if (this.peek()?.type === ",") this.take();
    }
    return fields;
  }

  parseValue() {
    const token = this.peek();
    if (!token) {
      this.diagnostics.push(issue(
        "syntax",
        "Ожидалось значение",
        { start: this.text.length, end: this.text.length },
      ));
      return null;
    }
    if (token.type === "{") return this.parseObject();
    if (token.type === "[") return this.parseArray();
    if (token.type === "operator" || token.type === "junk") {
      this.diagnostics.push(issue(
        "forbidden-effect",
        "Выражение с оператором не является значением конфигурации",
        token,
        { expected: "литерал, ссылка или путь" },
      ));
      this.take();
      return { type: "invalid", range: { start: token.start, end: token.end } };
    }
    if (token.type === "number") {
      this.take();
      return {
        type: "number",
        integer: token.integer,
        value: token.value,
        raw: token.raw,
        range: { start: token.start, end: token.end },
      };
    }
    if (token.type === "string") {
      this.take();
      return { type: "string", value: token.value, range: { start: token.start, end: token.end } };
    }
    if (token.type !== "ident") {
      this.diagnostics.push(issue("syntax", "Ожидалось значение", token));
      this.take();
      return { type: "invalid", range: { start: token.start, end: token.end } };
    }
    if (token.value === "null" || token.value === "true" || token.value === "false") {
      this.take();
      return {
        type: "literal",
        value: token.value === "null" ? null : token.value === "true",
        range: { start: token.start, end: token.end },
      };
    }
    if (token.value === "new") {
      this.diagnostics.push(issue(
        "forbidden-effect",
        "new допустим только в декларации устройства или Constant.Group",
        token,
        { expected: "ссылка или литерал" },
      ));
      this.skipBroken();
      return { type: "invalid", range: { start: token.start, end: token.end } };
    }
    return this.parsePath();
  }

  parsePath() {
    const first = this.take();
    const parts = [first.value];
    let end = first.end;
    while (this.peek()?.type === ".") {
      const dot = this.peek();
      const after = this.tokens[this.index + 1];
      if (after?.type === "ident" && after.value === "withQuality") {
        this.take();
        this.take();
        if (!this.expect("(")) break;
        const quality = this.parseQuality();
        const close = this.expect(")");
        end = close?.end ?? after.end;
        return {
          type: "path",
          parts,
          quality,
          range: { start: first.start, end },
        };
      }
      if (!after || after.type !== "ident") break;
      this.take();
      this.take();
      parts.push(after.value);
      end = after.end;
      void dot;
    }
    if (this.peek()?.type === "(") {
      this.diagnostics.push(issue(
        "forbidden-effect",
        "Вызов функции в значении конфигурации запрещён",
        this.peek(),
        { expected: "путь каталога или withQuality" },
      ));
      this.skipBroken();
    }
    if (parts.length === 1) {
      return { type: "ref", name: first.value, range: { start: first.start, end: first.end } };
    }
    return { type: "path", parts, quality: null, range: { start: first.start, end } };
  }

  parseQuality() {
    const root = this.expect("ident", "Quality");
    if (this.peek()?.type === ".") this.take();
    const name = this.expect("ident");
    if (!root || !name) return null;
    return { name: name.value, range: { start: root.start, end: name.end } };
  }
}

export function parseConfiguration(text) {
  if (typeof text !== "string") {
    return {
      statements: [],
      diagnostics: [issue("syntax", "Документ конфигурации должен быть строкой", null, { expected: "string" })],
    };
  }
  return new Parser(text).parse();
}

export function findNode(statement, path) {
  if (!statement) return null;
  let current = statement.type === "device" ? statement.object : { type: "object", fields: statement.fields ?? [] };
  for (const part of path) {
    if (!current) return null;
    if (typeof part === "number") {
      if (current.type !== "array") return null;
      current = current.items[part] ?? null;
      continue;
    }
    if (current.type !== "object") return null;
    const field = current.fields.find((item) => item.name === part);
    current = field?.value ?? null;
  }
  return current;
}
