import { Circuit, Signal, createWorkerExecutor } from "../../../src/index.js";
import { HoldPulse } from "./trace-devices.js";
import { Later } from "./promise-devices.js";
import { Spin } from "./spin-devices.js";

const A = Signal.Signals.signal_A;
const status = document.querySelector("#status");
const alive = document.querySelector("#alive");

function worker(scriptUrl, timeoutMs) {
  return createWorkerExecutor(new Worker(new URL("../../../src/event-worker.js", import.meta.url), { type: "module" }), {
    scriptUrl: new URL(scriptUrl, import.meta.url).href,
    timeoutMs,
  });
}

async function trace() {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  circuit.add(new HoldPulse({
    red_output: red,
    run: { every_tick: false, input_changed: false },
  }));
  const simulation = await circuit.createSimulation({
    executor: await worker("./trace-devices.js", 1000),
  });
  const values = [simulation.read(red, A)];
  for (let step = 0; step < 3; step += 1) {
    await simulation.step();
    values.push(simulation.read(red, A));
  }
  return values.join(",");
}

async function promiseCase() {
  const circuit = new Circuit();
  circuit.add(new Later({}));
  const simulation = await circuit.createSimulation({
    executor: await worker("./promise-devices.js", 1000),
  });
  try {
    await simulation.step();
    return "no-async";
  } catch (error) {
    return error.code;
  }
}

async function spin() {
  const circuit = new Circuit();
  circuit.add(new Spin({}));
  const simulation = await circuit.createSimulation({
    executor: await worker("./spin-devices.js", 400),
  });
  try {
    await simulation.step();
    return "no-timeout";
  } catch (error) {
    alive.textContent = "alive";
    return `${error.code}:${simulation.tick}:${alive.textContent}`;
  }
}

try {
  const parts = [await trace(), await promiseCase(), await spin()];
  status.textContent = parts.join("|");
} catch (error) {
  status.textContent = `fail:${error.name}:${error.message}`;
}
