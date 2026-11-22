import { Circuit, Signal, createWorkerExecutor } from "../../../src/index.js";
import { First, Second } from "./partial-devices.js";

const A = Signal.Signals.signal_A;
const status = document.querySelector("#status");
const alive = document.querySelector("#alive");

const worker = new Worker(new URL("../../../src/event-worker.js", import.meta.url), { type: "module" });
const executor = await createWorkerExecutor(worker, {
  scriptUrl: new URL("./partial-devices.js", import.meta.url).href,
  timeoutMs: 400,
});
const circuit = new Circuit();
const red = circuit.network("red_1");
const first = new First({ red_output: red, run: { every_tick: true, input_changed: false } });
circuit.add(first);
circuit.add(new Second({ run: { every_tick: true, input_changed: false } }));
const simulation = await circuit.createSimulation({ executor });

try {
  await simulation.step();
  status.textContent = "no-timeout";
} catch (error) {
  alive.textContent = "alive";
  const runtime = simulation.device(first);
  status.textContent = [
    `tick:${simulation.tick}`,
    `signal:${simulation.read(red, A)}`,
    `state:${runtime.state.n}`,
    `wakes:${runtime.wakes.join(",")}`,
    `code:${error.code}`,
    `alive:${alive.textContent}`,
  ].join("|");
}
