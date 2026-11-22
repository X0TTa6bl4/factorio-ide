import assert from "node:assert/strict";
import test from "node:test";
import { Constant, createProjectSession, createProjectStore, draftProject, exampleProject, openProfile, readProject } from "../../../src/index.js";

function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

function device(circuit, id) {
  return circuit.devices.find((item) => circuit.deviceId(item) === id);
}

test("экспорт и импорт сохраняют ID, связи, качество, профиль и исходник", async () => {
  delete globalThis.__fLogicImportRan;
  const loaded = readProject(exampleProject());
  const again = readProject(JSON.stringify(loaded.document));
  assert.deepEqual(again.document, loaded.document);
  assert.equal(JSON.stringify(loaded.document).includes("[object"), false);
  assert.equal(loaded.circuit.profile, "space-age");
  assert.equal(loaded.circuit.gameVersion, openProfile("space-age").gameVersion);
  assert.equal(loaded.circuit.seed, 9);
  assert.deepEqual(loaded.circuit.world, { origin: 4, dayLength: 25000 });

  const loop = loaded.circuit.networks.find((network) => network.id === "n1");
  const spare = loaded.circuit.networks.find((network) => network.id === "n4");
  const adder = device(loaded.circuit, "d3");
  assert.equal(adder.red_input, loop);
  assert.equal(adder.red_output, loop);
  assert.equal(adder.green_output, spare);
  assert.equal(device(loaded.circuit, "d1").red_output, loop);
  assert.equal(device(loaded.circuit, "d2").red_output, loop);

  const source = device(loaded.circuit, "d1");
  const copy = device(loaded.circuit, "d2");
  assert.equal(source.sections[0].group, source.sections[1].group);
  assert.equal(source.sections[0].group, copy.sections[0].group);
  assert.equal(source.sections[0].group.filters[0].signal.quality, "normal");
  assert.equal(loaded.document.devices.find((item) => item.name === "adder").config.return.quality, "uncommon");
  assert.equal(loaded.document.devices.find((item) => item.name === "grade").config.quality.name, "uncommon");

  const clock = device(loaded.circuit, "d7");
  const reply = device(loaded.circuit, "d8");
  assert.equal(loaded.circuit.receiverOf(clock), reply);
  assert.equal(loaded.circuit.receiverOf(reply), clock);
  assert.match(loaded.document.devices.find((item) => item.id === "d7").source, /__fLogicImportRan/);
  await loaded.circuit.createSimulation();
  assert.equal(globalThis.__fLogicImportRan, undefined);

  assert.equal(loaded.circuit.network("green_extra").id, "n5");
  const signal = openProfile("space-age").importSignal({ type: "virtual", name: "signal-A" });
  const added = new Constant({
    enabled: true,
    signals: [{ signal, constant: 1 }],
    green_output: spare,
  });
  loaded.circuit.add(added);
  assert.equal(loaded.circuit.deviceId(added), "d9");
});

test("метасигнал и указатель качества проходят тем же кодированием", () => {
  const draft = draftProject(exampleProject(), (project) => {
    const adder = project.devices.find((item) => item.name === "adder");
    adder.config.left_operand = {
      red: true,
      green: false,
      signal: { kind: "meta", name: "each" },
    };
    adder.config.right_operand = { constant: 1 };
    adder.config.return = { kind: "meta", name: "each" };
    const grade = project.devices.find((item) => item.name === "grade");
    grade.config.quality = { kind: "quality-selector", name: "signal-any-quality" };
  });
  const loaded = readProject(draft);
  assert.equal(loaded.document.devices.find((item) => item.name === "adder").config.return.kind, "meta");
  assert.equal(loaded.document.devices.find((item) => item.name === "grade").config.quality.kind, "quality-selector");
  assert.equal(device(loaded.circuit, "d3").red_input.id, "n1");
});

test("ошибочный импорт не меняет открытую схему", () => {
  const session = createProjectSession(exampleProject());
  const current = session.circuit;
  const cases = [
    ["{", "invalid-json"],
    [{ format: "blueprint" }, "foreign-format"],
    [draftProject(session.document, (project) => { project.version = 2; }), "unsupported-version"],
    [draftProject(session.document, (project) => { project.profile = "modded"; }), "unsupported-profile"],
    [draftProject(session.document, (project) => { project.gameVersion = "1.0.0"; }), "unsupported-game"],
    [draftProject(session.document, (project) => { project.scenarioState = { tick: 1 }; }), "unsupported-scenario-state"],
    [draftProject(session.document, (project) => { project.networks[1].id = "n1"; }), "duplicate-id"],
    [draftProject(session.document, (project) => { project.devices[2].ports.red_input = "n99"; }), "missing-network"],
    [draftProject(session.document, (project) => {
      project.devices.find((item) => item.name === "clock").receiver = "d99";
    }), "missing-device"],
  ];
  for (const [input, code] of cases) {
    assert.throws(() => session.replace(input), (error) => error.code === code);
    assert.equal(session.circuit, current);
    assert.equal(session.document.name, "Петля");
    assert.equal(session.circuit.networks.find((network) => network.id === "n1").name, "red_loop");
  }
  assert.throws(
    () => session.replace(draftProject(session.document, (project) => {
      project.devices[2].ports.red_input = "n99";
    })),
    (error) => error.code === "missing-network" && error.message.includes("n99") && error.message.includes("devices.adder.ports.red_input"),
  );
  assert.throws(
    () => session.replace(draftProject(session.document, (project) => {
      project.devices.find((item) => item.name === "clock").receiver = "d99";
    })),
    (error) => error.code === "missing-device" && error.message.includes("devices.clock.receiver"),
  );
});

test("коллизия имени, квота и недоступное хранилище не портят запись", () => {
  const storage = memoryStorage();
  const store = createProjectStore(storage);
  const session = createProjectSession(exampleProject());
  const saved = store.save(session.document, { recordId: null });
  assert.equal(saved.recordId, "p1");
  assert.throws(
    () => store.save(session.document, { recordId: null }),
    (error) => error.code === "name-collision" && error.projectName === "Петля",
  );
  assert.equal(store.read("p1").document.seed, 9);
  assert.equal(session.document.name, "Петля");

  const replaced = store.save(draftProject(session.document, (project) => { project.seed = 4; }), {
    recordId: null,
    replace: true,
  });
  assert.equal(replaced.recordId, "p1");
  assert.equal(store.read("p1").document.seed, 4);
  const copy = store.save(draftProject(session.document, (project) => { project.name = "Копия"; }), { recordId: null });
  assert.equal(copy.recordId, "p2");
  assert.equal(store.list().map((item) => item.name).join(","), "Петля,Копия");

  storage.setItem = () => {
    const error = new Error("quota");
    error.name = "QuotaExceededError";
    throw error;
  };
  assert.throws(
    () => store.save(draftProject(session.document, (project) => { project.name = "Слом"; }), { recordId: "p1" }),
    (error) => error.code === "storage-quota",
  );
  storage.setItem = (key, value) => storage.data.set(key, String(value));
  assert.equal(store.read("p1").document.name, "Петля");
  assert.equal(store.read("p2").document.name, "Копия");
  assert.equal(session.circuit.deviceId(device(session.circuit, "d1")), "d1");

  const denied = createProjectStore({
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
    removeItem() {
      throw new Error("denied");
    },
  });
  assert.throws(() => denied.list(), (error) => error.code === "storage-unavailable");
  assert.throws(() => createProjectStore(null).save(session.document), (error) => error.code === "storage-unavailable");
  assert.equal(session.document.name, "Петля");
});

test("сбой каталога после записи схемы откатывает новую запись", () => {
  const data = new Map();
  let failIndex = true;
  const storage = {
    data,
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      if (failIndex && key === "f-logic.projects.v1") {
        const error = new Error("quota");
        error.name = "QuotaExceededError";
        throw error;
      }
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
  const store = createProjectStore(storage);
  assert.throws(() => store.save(exampleProject()), (error) => error.code === "storage-quota");
  assert.equal([...data.keys()].length, 0);
  failIndex = false;
  const saved = store.save(exampleProject());
  assert.equal(store.read(saved.recordId).document.name, "Петля");
});
