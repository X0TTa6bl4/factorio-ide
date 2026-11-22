/** Демонстрационные схемы отладчика. Это фикстуры проектной модели, не игровой эталон. */

import { Arithmetic, Circuit, Constant, Decider, Selector, Signal } from "../../src/index.js";

const A = Signal.Signals.signal_A;
const B = Signal.Signals.signal_B;
const C = Signal.Signals.signal_C;

function count(signal, constant) {
  return { signal, constant };
}

export const SCHEME_META = Object.freeze({
  sources: Object.freeze({
    title: "Два источника",
    kinds: "Постоянный, арифметический",
    watch: "red_bus",
    expect: "Граница 0, red_bus: signal-A = 7, signal-B = 3. После 1 шага signal-A исчезает, signal-B остаётся 3.",
  }),
  counter: Object.freeze({
    title: "Счётчик",
    kinds: "Арифметический",
    watch: "green_count",
    expect: "Граница 0: канала нет. После n успешных шагов signal-A в green_count равен n.",
  }),
  decider: Object.freeze({
    title: "Порог",
    kinds: "Постоянный, сравнивающий",
    watch: "green_gate",
    expect: "Граница 0: red_gate signal-A = 5, green_gate пуст. После 1 шага green_gate signal-B = 1.",
  }),
  selector: Object.freeze({
    title: "Число каналов",
    kinds: "Постоянный, выбирающий",
    watch: "red_count",
    expect: "Граница 0: red_items signal-A = 100 и signal-B = -2, red_count пуст. После 1 шага red_count signal-C = 2.",
  }),
  fault: Object.freeze({
    title: "Ошибка расчёта",
    kinds: "Постоянный, арифметический",
    watch: "red_fault",
    expect: "Граница 0: red_fault signal-A = 8. Шаг деления на 0 не публикует новую границу: код unsupported-case, тик остаётся 0.",
  }),
  invalid: Object.freeze({
    title: "Неверная конфигурация",
    kinds: "Арифметический",
    watch: null,
    expect: "Конструктор отклоняет right_operand: 5. Код invalid-operand, прогон не создаётся.",
  }),
  unsupported: Object.freeze({
    title: "Неподдержанный режим",
    kinds: "Выбирающий",
    watch: null,
    expect: "Selector.RANDOM с интервалом 0 отклоняется до прогона. Код unsupported-case. Это не заявление совместимости с игрой.",
  }),
});

export const SCHEME_IDS = Object.freeze(Object.keys(SCHEME_META));

export function schemeMeta(id) {
  return SCHEME_META[id] ?? null;
}

function sources() {
  const circuit = new Circuit({ profile: "base" });
  const bus = circuit.network("red_bus");
  const iron = new Constant({
    enabled: true,
    red_output: bus,
    signals: [count(A, 5)],
  });
  const extra = new Constant({
    enabled: true,
    red_output: bus,
    signals: [count(A, 2), count(B, 3)],
  });
  const inverter = new Arithmetic({
    red_input: bus,
    red_output: bus,
    left_operand: { red: true, green: false, signal: A },
    right_operand: { constant: -1 },
    operation: Arithmetic.Operation.MUL,
    return: A,
  });
  circuit.add(iron);
  circuit.add(extra);
  circuit.add(inverter);
  return {
    circuit,
    blurb: "Два постоянных пишут в red_bus: signal-A складывается как 5+2, signal-B остаётся 3. Арифметический умножает прочитанный signal-A на −1 и пишет его в ту же сеть. На следующем тике сумма signal-A становится 0 и канал исчезает из агрегата; собственные выходы постоянных не меняются.",
    devices: [
      { device: iron, summary: "signal-A = 5 → red_bus" },
      { device: extra, summary: "signal-A = 2, signal-B = 3 → red_bus" },
      { device: inverter, summary: "signal-A × −1 → signal-A, red_bus" },
    ],
  };
}

function counter() {
  const circuit = new Circuit({ profile: "base" });
  const loop = circuit.network("green_count");
  const adder = new Arithmetic({
    green_input: loop,
    green_output: loop,
    left_operand: { red: false, green: true, signal: A },
    right_operand: { constant: 1 },
    operation: Arithmetic.Operation.SUM,
    return: A,
  });
  circuit.add(adder);
  return {
    circuit,
    blurb: "Арифметический прибавляет 1 к signal-A и пишет его в ту же зелёную сеть. На границе 0 канала нет. После n успешных шагов signal-A равен n.",
    devices: [
      { device: adder, summary: "signal-A + 1 → signal-A, green_count" },
    ],
  };
}

function decider() {
  const circuit = new Circuit({ profile: "base" });
  const red = circuit.network("red_gate");
  const green = circuit.network("green_gate");
  const source = new Constant({
    enabled: true,
    red_output: red,
    signals: [count(A, 5)],
  });
  const gate = new Decider({
    red_input: red,
    green_output: green,
    conditions: [{
      left_operand: { red: true, green: false, signal: A },
      right_operand: { constant: 0 },
      operation: Decider.Operation.GT,
    }],
    when_true: [count(B, 1)],
  });
  circuit.add(source);
  circuit.add(gate);
  return {
    circuit,
    blurb: "Постоянный пишет signal-A = 5 в red_gate уже на границе 0. Сравнивающий при signal-A > 0 публикует signal-B = 1 в green_gate на следующем тике.",
    devices: [
      { device: source, summary: "signal-A = 5 → red_gate" },
      { device: gate, summary: "signal-A > 0 → signal-B = 1, green_gate" },
    ],
  };
}

function selector() {
  const circuit = new Circuit({ profile: "base" });
  const input = circuit.network("red_items");
  const out = circuit.network("red_count");
  const source = new Constant({
    enabled: true,
    red_output: input,
    signals: [count(A, 100), count(B, -2)],
  });
  const counted = new Selector({
    operation: Selector.Operation.COUNT,
    signal: C,
    red_input: input,
    red_output: out,
  });
  circuit.add(source);
  circuit.add(counted);
  return {
    circuit,
    blurb: "Постоянный публикует два канала в red_items. Выбирающий в режиме count пишет число присутствующих каналов в signal-C сети red_count на следующем тике.",
    devices: [
      { device: source, summary: "signal-A = 100, signal-B = -2 → red_items" },
      { device: counted, summary: "count → signal-C, red_count" },
    ],
  };
}

function fault() {
  const circuit = new Circuit({ profile: "base" });
  const red = circuit.network("red_fault");
  const green = circuit.network("green_fault");
  const source = new Constant({
    enabled: true,
    red_output: red,
    signals: [count(A, 8)],
  });
  const divider = new Arithmetic({
    red_input: red,
    green_output: green,
    left_operand: { red: true, green: false, signal: A },
    right_operand: { constant: 0 },
    operation: Arithmetic.Operation.DIV,
    return: B,
  });
  circuit.add(source);
  circuit.add(divider);
  return {
    circuit,
    blurb: "Деление signal-A на 0 отклоняется до публикации следующей границы. Тик и уже видимый signal-A остаются прежними, следующие шаги не запускаются.",
    devices: [
      { device: source, summary: "signal-A = 8 → red_fault" },
      { device: divider, summary: "signal-A ÷ 0 → signal-B, green_fault" },
    ],
  };
}

function invalid() {
  new Arithmetic({
    left_operand: { red: true, green: false, signal: A },
    right_operand: 5,
    operation: Arithmetic.Operation.SUM,
    return: B,
  });
  return null;
}

function unsupported() {
  new Selector({
    operation: Selector.Operation.RANDOM,
    interval: 0,
  });
  return null;
}

const BUILDERS = {
  sources,
  counter,
  decider,
  selector,
  fault,
  invalid,
  unsupported,
};

export function buildScheme(id) {
  const build = BUILDERS[id];
  const meta = schemeMeta(id);
  if (!build || !meta) {
    const error = new Error(`Неизвестная схема ${id}`);
    error.code = "unknown-scheme";
    return { ok: false, error };
  }
  try {
    const built = build();
    if (!built) {
      const error = new Error("Схема не создана");
      error.code = "invalid-config";
      return { ok: false, error };
    }
    return {
      ok: true,
      id,
      ...built,
      title: meta.title,
      kinds: meta.kinds,
      watch: meta.watch,
      expect: meta.expect,
    };
  } catch (error) {
    return { ok: false, error };
  }
}
