/** Нагрузки 0020: цепи, циклы, редкие и плотные сети, выбирающий time.

Пауза 100 мс — интервал самой быстрой скорости отладчика, 10 тиков/с.
Медиана повторов сравнивается с этим интервалом. Отдельного порога памяти нет.
*/

import { Arithmetic, Circuit, Constant, Decider, Selector, Signal } from "../../../src/index.js";

const A = Signal.Signals.signal_A;
const B = Signal.Signals.signal_B;
const T = Signal.Signals.signal_T;
const SUM = Arithmetic.Operation.SUM;
const MUL = Arithmetic.Operation.MUL;
const GT = Decider.Operation.GT;
const redOnly = { red: true, green: false };

export const PROFILE = Object.freeze({
  seed: 1,
  historyLimit: 32,
  warmup: 2,
  repetitions: 5,
  sizes: Object.freeze([1024, 4096, 8192]),
  scenarios: Object.freeze(["chain", "cycle", "sparse", "dense", "clock"]),
  playbackIntervalMs: 100,
});

function measuredSteps() {
  return PROFILE.warmup + PROFILE.repetitions;
}

function count(signal, constant) {
  return { signal, constant };
}

function wire(signal) {
  return { ...redOnly, signal };
}

function requireSize(size) {
  if (!Number.isInteger(size) || size < 8) {
    throw new Error("Размер нагрузки должен быть целым числом от 8");
  }
}

function chain(size) {
  const circuit = new Circuit({ seed: PROFILE.seed });
  const networks = [];
  for (let index = 0; index <= size; index += 1) networks.push(circuit.network(`red_${index}`));
  circuit.add(new Constant({ enabled: true, red_output: networks[0], signals: [count(A, 1)] }));
  for (let index = 0; index < size; index += 1) {
    circuit.add(new Arithmetic({
      red_input: networks[index],
      red_output: networks[index + 1],
      left_operand: wire(A),
      right_operand: { constant: 0 },
      operation: SUM,
      return: A,
    }));
  }
  const steps = measuredSteps();
  return {
    circuit,
    check(simulation) {
      if (simulation.read(networks[0], A) !== 1) throw new Error("Источник цепи потерял signal-A");
      if (simulation.read(networks[steps], A) !== 1) throw new Error("Сигнал цепи не дошёл до шага измерения");
      if (simulation.read(networks[steps + 1], A) !== 0) throw new Error("Сигнал цепи прошёл дальше числа шагов");
    },
  };
}

function cycle(size) {
  const circuit = new Circuit({ seed: PROFILE.seed });
  const networks = [];
  for (let index = 0; index < size; index += 1) networks.push(circuit.network(`red_${index}`));
  for (let index = 0; index < size; index += 1) {
    circuit.add(new Arithmetic({
      red_input: networks[index],
      red_output: networks[(index + 1) % size],
      left_operand: wire(A),
      right_operand: { constant: 1 },
      operation: SUM,
      return: A,
    }));
  }
  const steps = measuredSteps();
  return {
    circuit,
    check(simulation) {
      if (simulation.read(networks[0], A) !== steps) {
        throw new Error(`Цикл: ожидалось signal-A = ${steps}`);
      }
    },
  };
}

function sparse(size) {
  const circuit = new Circuit({ seed: PROFILE.seed });
  const output = circuit.network("red_out_0");
  for (let index = 0; index < size; index += 1) {
    const source = circuit.network(`red_src_${index}`);
    const target = index === 0 ? output : circuit.network(`red_out_${index}`);
    circuit.add(new Constant({ enabled: true, red_output: source, signals: [count(A, 1)] }));
    circuit.add(new Arithmetic({
      red_input: source,
      red_output: target,
      left_operand: wire(A),
      right_operand: { constant: 2 },
      operation: MUL,
      return: B,
    }));
  }
  return {
    circuit,
    check(simulation) {
      if (simulation.read(output, B) !== 2) throw new Error("Разреженная пара не сохранила signal-B = 2");
    },
  };
}

function dense(size) {
  const circuit = new Circuit({ seed: PROFILE.seed });
  const bus = circuit.network("red_bus");
  const output = circuit.network("green_out");
  circuit.add(new Arithmetic({
    red_input: bus,
    red_output: bus,
    left_operand: wire(A),
    right_operand: { constant: 1 },
    operation: SUM,
    return: A,
  }));
  for (let index = 0; index < size; index += 1) {
    circuit.add(new Decider({
      red_input: bus,
      green_output: output,
      conditions: [{
        left_operand: wire(A),
        operation: GT,
        right_operand: { constant: 0 },
      }],
      when_true: [count(B, 1)],
    }));
  }
  const steps = measuredSteps();
  return {
    circuit,
    check(simulation) {
      if (simulation.read(bus, A) !== steps) throw new Error("Плотная шина не увеличила signal-A");
      if (simulation.read(output, B) !== size) throw new Error("Плотные сравнивающие не сложили signal-B");
    },
  };
}

function clock(size) {
  const circuit = new Circuit({
    seed: PROFILE.seed,
    world: { origin: 0, dayLength: 25000 },
  });
  const output = circuit.network("red_out");
  for (let index = 0; index < size; index += 1) {
    circuit.add(new Selector({
      operation: Selector.Operation.TIME,
      game_tick: T,
      red_output: output,
    }));
  }
  const published = measuredSteps() - 1;
  return {
    circuit,
    check(simulation) {
      if (simulation.read(output, T) !== published * size) {
        throw new Error("Выбирающие time не сложили signal-T");
      }
    },
  };
}

const BUILDERS = { chain, cycle, sparse, dense, clock };

export function buildScenario(name, size) {
  requireSize(size);
  const build = BUILDERS[name];
  if (!build) throw new Error(`Неизвестная нагрузка ${name}`);
  return build(size);
}

function readMemory() {
  if (typeof process === "object" && process && typeof process.memoryUsage === "function") {
    const usage = process.memoryUsage();
    return { heapUsed: usage.heapUsed, rss: usage.rss };
  }
  const heap = globalThis.performance?.memory?.usedJSHeapSize;
  return { heapUsed: typeof heap === "number" ? heap : null, rss: null };
}

function nextTurn() {
  return new Promise((resolve) => {
    if (typeof setImmediate === "function") setImmediate(resolve);
    else setTimeout(resolve, 0);
  });
}

function medianOf(samples) {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[(ordered.length - 1) >> 1];
}

export function environment() {
  if (typeof process === "object" && process?.versions?.node) {
    return {
      runtime: "node",
      version: process.version,
      platform: `${process.platform}/${process.arch}`,
    };
  }
  return {
    runtime: "browser",
    version: globalThis.navigator?.userAgent ?? "unknown",
    platform: globalThis.navigator?.platform ?? "unknown",
  };
}

export async function measureScheduler(name, size, scheduler, capture = false) {
  if (scheduler !== "full" && scheduler !== "optimized") {
    throw new Error("Планировщик измерения должен быть full или optimized");
  }
  const built = buildScenario(name, size);
  const simulation = await built.circuit.createSimulation({
    scheduler,
    historyLimit: PROFILE.historyLimit,
  });
  for (let index = 0; index < PROFILE.warmup; index += 1) await simulation.step();
  const samples = [];
  for (let index = 0; index < PROFILE.repetitions; index += 1) {
    const started = performance.now();
    await simulation.step();
    samples.push(performance.now() - started);
  }
  const memory = readMemory();
  const turned = performance.now();
  await nextTurn();
  built.check(simulation);
  return {
    row: {
      scenario: name,
      size,
      scheduler,
      seed: PROFILE.seed,
      historyLimit: PROFILE.historyLimit,
      warmup: PROFILE.warmup,
      repetitions: PROFILE.repetitions,
      min: Math.min(...samples),
      median: medianOf(samples),
      max: Math.max(...samples),
      resumeGap: performance.now() - turned,
      heapUsed: memory.heapUsed,
      rss: memory.rss,
    },
    snapshot: capture ? simulation.capture() : null,
  };
}

export function decideWorker(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Нет измерений для решения о Worker");
  }
  let worst = rows[0];
  for (const row of rows) {
    if (typeof row?.median !== "number" || !Number.isFinite(row.median)) {
      throw new Error("Медиана шага должна быть конечным числом");
    }
    if (row.median > worst.median) worst = row;
  }
  return {
    moveEngine: worst.median >= PROFILE.playbackIntervalMs,
    playbackIntervalMs: PROFILE.playbackIntervalMs,
    worst: {
      scenario: worst.scenario,
      size: worst.size,
      scheduler: worst.scheduler,
      median: worst.median,
    },
  };
}
