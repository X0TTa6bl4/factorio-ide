/** Запуск init/main EventCombinator в порядке запроса prepare. */

import { runScript } from "./event.js";

function scheduled(request, view) {
  if (request.phase === "init") return true;
  const run = view.run;
  if (run.every_tick) return true;
  if (run.input_changed && view.inputChanged === true) return true;
  if (view.messages.length > 0) return true;
  if (view.wakes.includes(request.tick)) return true;
  return false;
}

export function runPrepare(request, byId) {
  const ids = new Map();
  for (const [id, device] of byId) ids.set(device, id);
  const devices = [];
  for (const view of request.devices) {
    const device = byId.get(view.id);
    if (!device) continue;
    if (!scheduled(request, view)) continue;
    devices.push(runScript(device, {
      id: view.id,
      phase: request.phase,
      tick: request.tick,
      nextTick: request.nextTick,
      profile: request.profile,
      view,
      ids,
      byId,
    }));
  }
  return {
    runId: request.runId,
    revision: request.revision,
    stepId: request.stepId,
    phase: request.phase,
    tick: request.tick,
    devices,
  };
}

export function createScenarioExecutor(records, profile) {
  const byId = new Map();
  for (const record of records) {
    if (record.event) byId.set(record.id, record.device);
  }
  return {
    replayInit: true,
    prepare(request) {
      return runPrepare({ ...request, profile }, byId);
    },
  };
}
