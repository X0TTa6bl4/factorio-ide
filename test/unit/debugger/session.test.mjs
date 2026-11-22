import assert from "node:assert/strict";
import test from "node:test";
import { Signal } from "../../../src/index.js";
import { createPlayback } from "../../../pages/debugger/playback.js";
import { buildScheme } from "../../../pages/debugger/schemes.js";
import { diffRows, indexSignals } from "../../../pages/debugger/signals.js";

const A = Signal.Signals.signal_A;
const B = Signal.Signals.signal_B;

function createClock() {
  let time = 0;
  let seq = 0;
  const timers = [];
  return {
    schedule(delay, fn) {
      const item = { id: ++seq, at: time + delay, fn, cancelled: false };
      timers.push(item);
      return {
        cancel() {
          item.cancelled = true;
        },
      };
    },
    async advance(ms) {
      time += ms;
      for (;;) {
        const due = timers
          .filter((item) => !item.cancelled && item.at <= time)
          .sort((left, right) => left.at - right.at || left.id - right.id);
        if (due.length === 0) return;
        const next = due[0];
        timers.splice(timers.indexOf(next), 1);
        await next.fn();
      }
    },
  };
}

function networkNamed(built, name) {
  for (const item of built.devices) {
    for (const key of ["red_input", "green_input", "red_output", "green_output"]) {
      const network = item.device[key];
      if (network && network.name === name) return network;
    }
  }
  throw new Error(name);
}

function amount(output, signal) {
  return output.find((entry) => entry.signal === signal)?.constant;
}

async function manualCounter(steps) {
  const built = buildScheme("counter");
  const simulation = await built.circuit.createSimulation();
  const loop = networkNamed(built, "green_count");
  for (let index = 0; index < steps; index += 1) await simulation.step();
  return { tick: simulation.tick, value: simulation.read(loop, A) };
}

test("пауза отменяет будущий шаг, скорость не меняет последовательность", async () => {
  const clock = createClock();
  const seen = [];
  let gap = 100;
  const playback = createPlayback({
    perform: async () => {
      seen.push(gap);
    },
    schedule: clock.schedule,
    interval: () => gap,
  });
  await playback.start();
  assert.deepEqual(seen, [100]);
  await clock.advance(100);
  assert.deepEqual(seen, [100, 100]);
  gap = 1000;
  await clock.advance(99);
  assert.equal(seen.length, 2);
  await clock.advance(1);
  assert.equal(seen.length, 3);
  await clock.advance(999);
  assert.equal(seen.length, 3);
  await clock.advance(1);
  assert.equal(seen.length, 4);
  playback.pause();
  await clock.advance(5000);
  assert.equal(seen.length, 4);
  await playback.step();
  assert.equal(seen.length, 5);
  assert.equal(playback.mode, "paused");
});

test("ошибка шага останавливает следующие вызовы", async () => {
  const clock = createClock();
  let calls = 0;
  const playback = createPlayback({
    perform: async () => {
      calls += 1;
      if (calls === 2) {
        const error = new Error("стоп");
        error.code = "unsupported-case";
        throw error;
      }
    },
    schedule: clock.schedule,
    interval: () => 50,
  });
  await playback.start();
  await clock.advance(50);
  assert.equal(playback.mode, "failed");
  assert.equal(calls, 2);
  assert.equal(playback.completed, 1);
  await clock.advance(500);
  assert.equal(calls, 2);
  await assert.rejects(playback.step(), (error) => error.code === "playback-stopped");
  assert.equal(calls, 2);
  assert.equal(await playback.start(), false);
});

test("ручной счётчик и автозапуск дают одну границу, reset повторяется", async () => {
  const reference = await manualCounter(4);
  assert.deepEqual(reference, { tick: 4, value: 4 });

  const built = buildScheme("counter");
  const simulation = await built.circuit.createSimulation();
  const loop = networkNamed(built, "green_count");
  const clock = createClock();
  let gap = 100;
  const playback = createPlayback({
    perform: () => simulation.step(),
    schedule: clock.schedule,
    interval: () => gap,
  });
  await playback.start();
  for (let index = 0; index < 3; index += 1) await clock.advance(100);
  playback.pause();
  gap = 1000;
  await clock.advance(1000);
  assert.equal(simulation.tick, 4);
  assert.equal(simulation.read(loop, A), 4);
  await playback.step();
  assert.equal(simulation.tick, 5);
  assert.deepEqual(await manualCounter(5), { tick: 5, value: simulation.read(loop, A) });

  await simulation.reset();
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.read(loop, A), 0);
  await simulation.step();
  await simulation.reset();
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.present(loop).length, 0);
});

test("неверная конфигурация не создаёт прогон, деление на ноль не публикует тик", async () => {
  const invalid = buildScheme("invalid");
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "invalid-operand");

  const built = buildScheme("fault");
  const simulation = await built.circuit.createSimulation();
  const red = networkNamed(built, "red_fault");
  assert.equal(simulation.read(red, A), 8);
  const clock = createClock();
  let calls = 0;
  const playback = createPlayback({
    perform: async () => {
      calls += 1;
      await simulation.step();
    },
    schedule: clock.schedule,
    interval: () => 100,
  });
  await playback.start();
  assert.equal(playback.mode, "failed");
  assert.equal(simulation.tick, 0);
  assert.equal(simulation.read(red, A), 8);
  assert.equal(calls, 1);
  await clock.advance(1000);
  await assert.rejects(playback.step(), (error) => error.code === "playback-stopped");
  assert.equal(calls, 1);
  assert.equal(simulation.tick, 0);
});

test("агрегат сети и собственный выход не смешиваются, исчезновение отмечено", async () => {
  const built = buildScheme("sources");
  const simulation = await built.circuit.createSimulation();
  const bus = networkNamed(built, "red_bus");
  const [iron, extra, inverter] = built.devices.map((item) => item.device);
  assert.equal(simulation.read(bus, A), 7);
  assert.equal(simulation.read(bus, B), 3);
  assert.equal(amount(simulation.device(iron).output.red, A), 5);
  assert.equal(amount(simulation.device(extra).output.red, A), 2);
  assert.equal(amount(simulation.device(extra).output.red, B), 3);
  assert.equal(simulation.device(inverter).output.red.length, 0);

  const before = indexSignals(simulation.present(bus));
  await simulation.step();
  const rows = diffRows(before, indexSignals(simulation.present(bus)), true);
  assert.equal(rows.find((row) => row.name === "signal-A").change, "gone");
  assert.equal(rows.find((row) => row.name === "signal-A").delta, "исчез");
  assert.equal(rows.find((row) => row.name === "signal-B").change, "same");
  assert.equal(simulation.read(bus, B), 3);
  assert.equal(amount(simulation.device(iron).output.red, A), 5);
  assert.equal(amount(simulation.device(extra).output.red, A), 2);
  assert.equal(amount(simulation.device(inverter).output.red, A), -7);
});
