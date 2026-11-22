/** Порядок полей классов и вложенных объектов. Подсказки, вставка и форматтер читают один список. */

export const DEVICE_FIELDS = {
  Arithmetic: ["red_input", "green_input", "red_output", "green_output", "left_operand", "right_operand", "operation", "return"],
  Constant: ["enabled", "signals", "sections", "red_output", "green_output"],
  Decider: ["red_input", "green_input", "red_output", "green_output", "conditions", "when_true", "when_false"],
  Selector: [
    "red_input", "green_input", "red_output", "green_output", "operation",
    "sort", "index", "compare", "signal", "interval", "quality", "source", "destination",
    "highest", "game_tick", "day_tick", "day_length",
  ],
  EventCombinator: ["red_input", "green_input", "red_output", "green_output", "state", "run"],
  Lamp: ["red_input", "green_input", "condition", "use_colors", "color_mode"],
  Storage: ["enabled", "mode", "contents", "red_output", "green_output"],
  Station: ["red_input", "green_input", "red_output", "green_output", "depart"],
  Train: ["route", "transit", "at"],
  "Constant.Group": ["name", "filters"],
};

const SELECTOR_FIELDS = {
  SELECT: ["sort", "index", "compare"],
  COUNT: ["signal"],
  RANDOM: ["interval"],
  STACK_SIZE: [],
  ROCKET_CAPACITY: [],
  QUALITY_FILTER: ["quality", "compare"],
  QUALITY_TRANSFER: ["source", "destination"],
  QUALITY_SELECT: ["highest"],
  TIME: ["game_tick", "day_tick", "day_length"],
};

const SELECTOR_PORTS = ["red_input", "green_input", "red_output", "green_output", "operation"];

export const WIRE_FIELDS = ["label"];
export const PEER_FIELDS = ["receiver"];

/** Первое Selector.Operation.<ИМЯ> в тексте объекта. Нет совпадения — полный список полей. */
export function selectorOperation(text) {
  const match = /Selector\.Operation\.([A-Z0-9_]+)/.exec(text ?? "");
  return match?.[1] ?? null;
}

export function selectorFieldList(operation) {
  const extra = operation != null && Object.hasOwn(SELECTOR_FIELDS, operation)
    ? SELECTOR_FIELDS[operation]
    : [...new Set(Object.values(SELECTOR_FIELDS).flat())];
  return [...SELECTOR_PORTS, ...extra];
}

export function schemaFor(owner, key) {
  if (!key) return { type: "device", fields: DEVICE_FIELDS[owner] ?? [] };
  if (key === "left_operand") {
    const fields = owner === "Decider" ? ["red", "green", "signal"] : ["red", "green", "signal", "constant"];
    return { type: "operand", fields };
  }
  if (key === "right_operand") return { type: "operand", fields: ["red", "green", "signal", "constant"] };
  if (key === "condition") return { type: "condition", fields: ["left_operand", "right_operand", "operation"] };
  if (key === "run") return { type: "run", fields: ["every_tick", "input_changed"] };
  if (key === "index") return { type: "index", fields: ["constant", "signal"] };
  if (key === "signals" || key === "when_true" || key === "when_false" || key === "contents") {
    return { type: "signal-count", fields: ["signal", "constant"] };
  }
  if (key === "sections") return { type: "section", fields: ["active", "filters", "group", "multiplier"] };
  if (key === "filters") return { type: "filter", fields: ["signal", "min", "max"] };
  if (owner === "Constant.Group") return { type: "group", fields: ["name", "filters"] };
  return { type: "unknown", fields: [] };
}

export function elementSchema(owner, key) {
  if (key === "conditions") return { type: "condition", fields: ["left_operand", "right_operand", "operation", "logic"] };
  if (key === "signals" || key === "when_true" || key === "when_false" || key === "contents") {
    return { type: "signal-count", fields: ["signal", "constant"] };
  }
  if (key === "sections") return { type: "section", fields: ["active", "filters", "group", "multiplier"] };
  if (key === "filters") return { type: "filter", fields: ["signal", "min", "max"] };
  return schemaFor(owner, key);
}

/** Имена полей в порядке подсказок. Неизвестные имена сюда не входят. */
export function fieldList(owner, key, options = {}) {
  const element = options.element === true;
  if (!key && owner === "Selector") return selectorFieldList(options.operation ?? null);
  if (!key && owner === "wire") return WIRE_FIELDS;
  if (!key && owner === "peers") return PEER_FIELDS;
  const schema = element ? elementSchema(owner, key) : schemaFor(owner, key);
  return schema.fields;
}
