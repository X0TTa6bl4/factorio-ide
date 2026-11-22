import assert from "node:assert/strict";
import test from "node:test";
import { INT32_MAX, INT32_MIN } from "../../../src/int32.js";
import {
  Circuit,
  OperationToken,
  Quality,
  Signal,
  channelKey,
  openProfile,
} from "../../../src/index.js";
import { rejectsCode, throwsCode } from "./support.mjs";

const A = Signal.Signals.signal_A;
const B = Signal.Signals.signal_B;
const C = Signal.Signals.signal_C;
const iron = Signal.Intermediate.iron_plate;
const copper = Signal.Intermediate.copper_plate;
const coal = Signal.Intermediate.coal;
const both = { red: true, green: true };
const redOnly = { red: true, green: false };
const greenOnly = { red: false, green: true };
const neither = { red: false, green: false };

function source(ports, signals, enabled = true) {
  return { enabled, signals, ...ports };
}

function count(signal, constant) {
  return { signal, constant };
}

test("NET-1 NET-3 NET-4 одинаковые ключи суммируются, ноль удаляется, int32 оборачивается", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_buffer");
  const chest = Signal.Logistic.wooden_chest;
  const derived = chest.withQuality(Quality.NORMAL);
  const imported = openProfile("base").importSignal({ type: "item", name: "wooden-chest" });
  assert.equal(channelKey(chest), channelKey(derived));
  assert.equal(channelKey(chest), channelKey(imported));
  circuit.add(source({ red_output: red }, [
    count(chest, 3),
    count(derived, 7),
    count(imported, 1),
    count(A, 0),
    count(B, 5),
    count(B, 0),
    count(B, -0),
    count(C, -4),
    count(iron, INT32_MAX),
    count(iron, 1),
    count(copper, INT32_MIN),
    count(copper, -1),
  ]));
  const simulation = await circuit.createSimulation();
  assert.equal(simulation.read(red, chest), 11);
  assert.equal(simulation.read(red, derived), 11);
  assert.equal(simulation.read(red, imported), 11);
  assert.equal(simulation.read(red, A), 0);
  assert.equal(simulation.read(red, B), 5);
  assert.equal(simulation.read(red, C), -4);
  assert.equal(simulation.read(red, iron), INT32_MIN);
  assert.equal(simulation.read(red, copper), INT32_MAX);
  const present = simulation.present(red);
  assert.equal(present.some((entry) => channelKey(entry.signal) === channelKey(A)), false);
  assert.equal(present.filter((entry) => channelKey(entry.signal) === channelKey(chest)).length, 1);
  const negative = present.find((entry) => channelKey(entry.signal) === channelKey(C));
  assert.equal(negative.constant, -4);
  negative.constant = 0;
  assert.equal(simulation.read(red, C), -4);
  const keys = present.map((entry) => channelKey(entry.signal));
  assert.deepEqual(keys, [...keys].sort());
});

test("NET-2 разные type и quality не смешиваются, normal задан по умолчанию", async () => {
  const base = new Circuit();
  const red = base.network("red_1");
  const item = Signal.Intermediate.water_barrel;
  const recipe = Signal.Intermediate.water_barrel.fill;
  assert.equal(item.name, recipe.name);
  assert.equal(item.quality, "normal");
  assert.notEqual(item.type, recipe.type);
  base.add(source({ red_output: red }, [count(item, 3), count(recipe, 7)]));
  const baseRun = await base.createSimulation();
  assert.equal(baseRun.read(red, item), 3);
  assert.equal(baseRun.read(red, recipe), 7);
  assert.equal(baseRun.present(red).length, 2);

  const spaceSignals = openProfile("space-age");
  const space = new Circuit({ profile: "space-age" });
  const green = space.network("green_1");
  const plate = spaceSignals.tree.Intermediate.iron_plate;
  const rare = plate.withQuality(Quality.RARE);
  space.add(source({ green_output: green }, [count(plate, 3), count(rare, 7)]));
  const spaceRun = await space.createSimulation();
  assert.equal(spaceRun.read(green, plate), 3);
  assert.equal(spaceRun.read(green, rare), 7);
  assert.equal(spaceRun.profile, "space-age");
  assert.equal(spaceRun.gameVersion, "2.1.24");
});

test("NET-5 NET-6 маски цветов читают выбранные сети и обнуляют сумму", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_plates");
  const green = circuit.network("green_plates");
  circuit.add(source({ red_output: red }, [count(iron, 10), count(copper, 4), count(A, 3)]));
  circuit.add(source({ green_output: green }, [count(iron, 3), count(coal, 7), count(A, -3)]));
  const simulation = await circuit.createSimulation();
  const ports = { red, green };
  assert.equal(simulation.readMask(ports, both, iron), 13);
  assert.equal(simulation.readMask(ports, both, copper), 4);
  assert.equal(simulation.readMask(ports, both, coal), 7);
  assert.equal(simulation.readMask(ports, redOnly, iron), 10);
  assert.equal(simulation.readMask(ports, redOnly, coal), 0);
  assert.equal(simulation.readMask(ports, greenOnly, iron), 3);
  assert.equal(simulation.readMask(ports, greenOnly, copper), 0);
  assert.equal(simulation.readMask(ports, neither, iron), 0);
  assert.equal(simulation.readMask(ports, both, A), 0);
  assert.deepEqual(simulation.presentMask(ports, neither), []);
  const masked = simulation.presentMask(ports, both);
  assert.equal(masked.find((entry) => channelKey(entry.signal) === channelKey(iron)).constant, 13);
  assert.equal(masked.find((entry) => channelKey(entry.signal) === channelKey(copper)).constant, 4);
  assert.equal(masked.find((entry) => channelKey(entry.signal) === channelKey(coal)).constant, 7);
  assert.equal(masked.some((entry) => channelKey(entry.signal) === channelKey(A)), false);
  assert.equal(simulation.readMask({ red, green: null }, both, iron), 10);
  assert.equal(simulation.readMask({ red: null, green }, greenOnly, coal), 7);
  assert.equal(simulation.read(red, iron), 10);
  assert.equal(simulation.read(green, iron), 3);
  assert.deepEqual(
    simulation.present(red).map((entry) => channelKey(entry.signal)),
    [channelKey(copper), channelKey(iron), channelKey(A)],
  );
});

test("NET-7 повторная регистрация не удваивает вклад, сети одного цвета не сливаются", async () => {
  const circuit = new Circuit();
  const greenA = circuit.network("green_1");
  const greenB = circuit.network("green_2");
  const red = circuit.network("red_1");
  const device = source({ green_output: greenA, red_output: red }, [count(A, 3)]);
  assert.equal(circuit.add(device), device);
  assert.equal(circuit.add(device), device);
  circuit.add(source({ green_output: greenB }, [count(A, 4)]));
  const reader = {
    red_input: red,
    red_output: red,
    operation: new OperationToken("Arithmetic", "SUM"),
  };
  circuit.add(reader);
  const simulation = await circuit.createSimulation();
  assert.equal(circuit.devices.length, 3);
  assert.equal(simulation.read(greenA, A), 3);
  assert.equal(simulation.read(greenB, A), 4);
  assert.equal(simulation.read(red, A), 3);
  assert.equal(simulation.readMask({ red, green: greenA }, both, A), 6);
  assert.equal(simulation.read(red, B), 0);
  assert.notEqual(greenA.id, greenB.id);
  assert.notEqual(greenA.id, "1");
  assert.notEqual(greenA.id, "2");
});

test("NET-8 CIR-1 CIR-3 чужая схема, цвет и повторное устройство", async () => {
  const first = new Circuit({ profile: "base", seed: 1 });
  const second = new Circuit({ profile: "base", seed: 1 });
  const red = first.network("red_1");
  const again = first.network("red_1");
  const green = first.network("green_buffer1");
  assert.equal(red, again);
  assert.equal(red.id, again.id);
  assert.equal(red.color, "red");
  assert.equal(green.color, "green");
  assert.notEqual(red, second.network("red_1"));
  assert.equal(second.network("red_1").name, "red_1");
  const device = source({ red_output: red }, [count(A, 3)]);
  const loose = source({}, []);
  first.add(device);
  first.add(loose);
  throwsCode(() => second.add(loose), "foreign-device");
  assert.equal(second.devices.length, 0);
  assert.equal(first.devices.length, 2);
  throwsCode(() => first.add(source({ red_output: green }, [count(A, 1)])), "wrong-color");
  throwsCode(() => first.add(source({ green_output: red }, [count(A, 1)])), "wrong-color");
  throwsCode(() => first.add(source({ red_output: second.network("red_2") }, [count(A, 1)])), "foreign-network");
  throwsCode(() => first.add(source({ red_output: "red_1" }, [count(A, 1)])), "invalid-port");
  throwsCode(() => first.add(source({ red_output: 1 }, [count(A, 1)])), "invalid-port");
  throwsCode(() => first.add({ red_output: undefined, enabled: true, signals: [] }), "invalid-port");
  throwsCode(() => first.add(source({ red_input: new OperationToken("Arithmetic", "SUM") }, [])), "invalid-port");
  throwsCode(() => first.add(source({ red_input: A }, [])), "invalid-port");
  throwsCode(() => first.add(source({ red_input: Signal.Meta.signal_each }, [])), "invalid-port");
  throwsCode(() => first.add(source({ red_input: Quality.NORMAL }, [])), "invalid-port");
  throwsCode(() => first.add(source({
    red_input: openProfile("space-age").tree.Unsorted.signal_any_quality,
  }, [])), "invalid-port");
  assert.equal(first.devices.length, 2);
  assert.equal(first.deviceId(device), "d1");
  const simulation = await first.createSimulation();
  assert.equal(simulation.read(red, A), 3);
});

test("NET-9 TOK-3 метасигнал, операция и чужой профиль не становятся каналом", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const plain = { kind: "signal", type: "virtual", name: "signal-A", quality: "normal" };
  throwsCode(() => circuit.add(source({ red_output: red }, [count(Signal.Meta.signal_everything, 1)])), "meta-signal");
  throwsCode(() => circuit.add(source({ red_output: red }, [count(new OperationToken("Arithmetic", "SUM"), 1)])), "invalid-signal");
  throwsCode(() => circuit.add(source({ red_output: red }, [count(Quality.RARE, 1)])), "invalid-signal");
  throwsCode(() => circuit.add(source({ red_output: red }, [count(plain, 1)])), "invalid-signal");
  throwsCode(() => circuit.add(source({ red_output: red }, [count(openProfile("space-age").tree.Combat.railgun, 1)])), "wrong-profile");
  const space = new Circuit({ profile: "space-age" });
  throwsCode(() => space.add(source({ red_output: space.network("red_1") }, [count(A, 1)])), "wrong-profile");
  assert.equal(circuit.devices.length, 0);
  circuit.add(source({ red_output: red }, [count(A, 1)]));
  const simulation = await circuit.createSimulation();
  throwsCode(() => simulation.read(red, Signal.Meta.signal_anything), "meta-signal");
  throwsCode(() => simulation.read(red, new OperationToken("Arithmetic", "SUM")), "invalid-signal");
  throwsCode(() => simulation.read(red, Quality.NORMAL), "invalid-signal");
  throwsCode(() => simulation.read(red, plain), "invalid-signal");
});

test("CIR-2 CIR-4 CIR-5 ссылка живёт до успешной подготовки, rename сохраняет ID", async () => {
  const circuit = new Circuit();
  const green = circuit.network("green_2");
  const spare = circuit.network("green_spare");
  const red = circuit.network("red_1");
  assert.equal(circuit.network("green_2"), green);
  assert.notEqual(green.id, "2");
  throwsCode(() => circuit.renameNetwork(green, "red_9"), "wrong-color");
  assert.equal(green.name, "green_2");
  const kept = circuit.network("green_buffer1");
  const device = source({ red_output: red, green_output: kept }, [count(A, 2)]);
  circuit.add(device);
  assert.equal(circuit.network("green_spare"), spare);
  device.signals = [count(Signal.Meta.signal_each, 1)];
  await rejectsCode(circuit.createSimulation(), "meta-signal");
  assert.equal(circuit.network("green_spare"), spare);
  assert.equal(circuit.devices.length, 1);
  device.signals = [count(A, 2)];
  device.signals.push(count(A, "3"));
  await rejectsCode(circuit.createSimulation(), "invalid-constant");
  device.signals = [count(A, 2)];
  const firstId = kept.id;
  assert.equal(circuit.renameNetwork(kept, "green_buffer1"), kept);
  circuit.renameNetwork(kept, "green_buffer2");
  assert.equal(kept.id, firstId);
  assert.equal(kept.name, "green_buffer2");
  assert.equal(circuit.network("green_buffer2"), kept);
  const revived = circuit.network("green_buffer1");
  assert.notEqual(revived.id, kept.id);
  const simulation = await circuit.createSimulation();
  assert.equal(simulation.seed, 1);
  assert.equal(simulation.profile, "base");
  assert.equal(simulation.read(red, A), 2);
  assert.equal(simulation.read(kept, A), 2);
  assert.notEqual(circuit.network("green_spare"), spare);
  assert.notEqual(circuit.network("green_spare").id, spare.id);
  assert.equal(spare.circuit, null);
  throwsCode(() => simulation.read(spare, A), "not-in-simulation");
  throwsCode(() => simulation.present(spare), "not-in-simulation");
  throwsCode(() => circuit.renameNetwork(spare, "green_other"), "missing-network");
  throwsCode(() => circuit.add(source({ green_output: spare }, [count(A, 1)])), "missing-network");
  const occupied = circuit.network("green_taken");
  circuit.add({ green_input: occupied });
  throwsCode(() => circuit.renameNetwork(occupied, "green_buffer2"), "occupied-name");
  assert.equal(occupied.name, "green_taken");
  const removed = await circuit.createSimulation();
  assert.equal(removed.read(kept, A), 2);
  assert.notEqual(circuit.network("green_2").id, green.id);
});

test("снимок не зависит от последующего описания и второго прогона", async () => {
  const circuit = new Circuit({ seed: 0 });
  const red = circuit.network("red_1");
  const device = source({ red_output: red }, [count(A, 3)]);
  circuit.add(device);
  const first = await circuit.createSimulation();
  device.signals = [count(A, 9)];
  const second = await circuit.createSimulation();
  assert.equal(first.read(red, A), 3);
  assert.equal(second.read(red, A), 9);
  assert.equal(first.seed, 0);
  assert.equal(circuit.seed, 0);
  assert.equal(circuit.gameVersion, "2.1.24");
  device.signals = [count(A, 1.5)];
  throwsCode(() => circuit.add(device), "invalid-constant");
  assert.equal(circuit.deviceId(device), "d1");
  assert.equal(second.read(red, A), 9);
});

test("пустой вклад, отключённый источник и провод без signals", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const green = circuit.network("green_1");
  const spare = circuit.network("green_spare");
  circuit.add(source({ red_output: red }, []));
  circuit.add(source({ green_output: green }, [count(A, 5)], false));
  circuit.add({
    red_input: red,
    green_output: null,
    operation: new OperationToken("Decider", "GT"),
  });
  const simulation = await circuit.createSimulation();
  assert.equal(simulation.read(red, A), 0);
  assert.equal(simulation.read(green, A), 0);
  assert.equal(circuit.network("red_1"), red);
  assert.equal(circuit.network("green_1"), green);
  assert.notEqual(circuit.network("green_spare"), spare);
  const only = new Circuit();
  const unused = only.network("red_unused");
  only.add(source({}, [count(A, 3)]));
  await only.createSimulation();
  assert.notEqual(only.network("red_unused").id, unused.id);
  assert.equal(only.devices.length, 1);
});

test("регистрация отклоняет неполные SignalCount и неподдерживаемые настройки", () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const green = circuit.network("green_1");
  const valid = count(A, 1);
  throwsCode(() => circuit.add(null), "invalid-device");
  throwsCode(() => circuit.add("device"), "invalid-device");
  throwsCode(() => circuit.add([]), "invalid-device");
  throwsCode(() => circuit.add(source({ red_output: red, sections: [] }, [valid])), "unsupported-setting");
  throwsCode(() => circuit.add(source({ red_output: red, group: "a" }, [valid])), "unsupported-setting");
  throwsCode(() => circuit.add(source({ red_output: red, multiplier: 2 }, [valid])), "unsupported-setting");
  throwsCode(() => circuit.add({ red_output: red, signals: [valid], red_input: red }), "forbidden-input");
  throwsCode(() => circuit.add({ green_output: green, signals: [valid], green_input: green }), "forbidden-input");
  throwsCode(() => circuit.add({ red_output: red, signals: [valid] }), "invalid-enabled");
  throwsCode(() => circuit.add({ red_output: red, signals: [valid], enabled: "true" }), "invalid-enabled");
  throwsCode(() => circuit.add({ red_output: red, signals: {}, enabled: true }), "invalid-signals");
  throwsCode(() => circuit.add(source({ red_output: red }, [null])), "invalid-signal-count");
  throwsCode(() => circuit.add(source({ red_output: red }, [1])), "invalid-signal-count");
  throwsCode(() => circuit.add(source({ red_output: red }, [[]])), "invalid-signal-count");
  throwsCode(() => circuit.add(source({ red_output: red }, [{}])), "invalid-signal-count");
  throwsCode(() => circuit.add(source({ red_output: red }, [{ signal: A }])), "invalid-signal-count");
  throwsCode(() => circuit.add(source({ red_output: red }, [{ signal: A, extra: 1 }])), "invalid-signal-count");
  throwsCode(() => circuit.add(source({ red_output: red }, [{ constant: 1, extra: 1 }])), "invalid-signal-count");
  throwsCode(() => circuit.add(source({ red_output: red }, [{ signal: A, constant: 1, extra: 1 }])), "invalid-signal-count");
  throwsCode(() => circuit.add(source({ red_output: red }, [count(A, "5")])), "invalid-constant");
  throwsCode(() => circuit.add(source({ red_output: red }, [count(A, 1.5)])), "invalid-constant");
  throwsCode(() => circuit.add(source({ red_output: red }, [count(A, INT32_MAX + 1)])), "invalid-constant");
  throwsCode(() => circuit.add(source({ red_output: red }, [count(A, INT32_MIN - 1)])), "invalid-constant");
  throwsCode(() => circuit.add(source({ red_output: red }, [count(A, true)])), "invalid-constant");
  throwsCode(() => circuit.add(source({ enabled: false, red_output: red }, [count(Signal.Meta.signal_each, 1)])), "meta-signal");
  assert.equal(circuit.devices.length, 0);
  const limits = source({ red_output: red }, [count(A, INT32_MAX), count(B, INT32_MIN)]);
  circuit.add(limits);
  assert.equal(circuit.deviceId(limits), "d1");
});

test("имена сетей, seed и параметры Circuit", () => {
  const circuit = new Circuit();
  assert.equal(circuit.profile, "base");
  assert.equal(circuit.seed, 1);
  const red = circuit.network("red_a_1");
  const green = circuit.network("green__2");
  assert.equal(red.color, "red");
  assert.equal(green.color, "green");
  assert.equal(red.id, "n1");
  assert.equal(green.id, "n2");
  throwsCode(() => circuit.network("red_new"), "reserved-name");
  throwsCode(() => circuit.network("green_new"), "reserved-name");
  throwsCode(() => circuit.network(1), "invalid-name");
  throwsCode(() => circuit.network("blue_1"), "invalid-name");
  throwsCode(() => circuit.network("red_"), "invalid-name");
  throwsCode(() => circuit.network("red_a-b"), "invalid-name");
  throwsCode(() => circuit.network("RED_1"), "invalid-name");
  assert.equal(circuit.network("red_a_1").id, "n1");
  throwsCode(() => circuit.renameNetwork({ id: red.id }, "red_b"), "invalid-port");
  throwsCode(() => circuit.renameNetwork(new Circuit().network("red_9"), "red_8"), "foreign-network");
  throwsCode(() => new Circuit(null), "invalid-circuit-options");
  throwsCode(() => new Circuit("base"), "invalid-circuit-options");
  throwsCode(() => new Circuit([]), "invalid-circuit-options");
  throwsCode(() => new Circuit({ extra: true }), "invalid-circuit-options");
  throwsCode(() => new Circuit({ profile: "mod" }), "invalid-profile");
  throwsCode(() => new Circuit({ seed: "1" }), "invalid-seed");
  throwsCode(() => new Circuit({ seed: 1.5 }), "invalid-seed");
  throwsCode(() => new Circuit({ seed: -1 }), "invalid-seed");
  throwsCode(() => new Circuit({ seed: 4294967296 }), "invalid-seed");
  const custom = new Circuit({ profile: "space-age", seed: 4294967295 });
  assert.equal(custom.profile, "space-age");
  assert.equal(custom.seed, 4294967295);
  const seeded = new Circuit({ seed: 0 });
  assert.equal(seeded.profile, "base");
  assert.equal(seeded.seed, 0);
  assert.throws(() => {
    red.name = "red_other";
  }, TypeError);
  assert.equal(red.name, "red_a_1");
});

test("remove, setPeers и перенос устройства после снятия", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const event = { red_input: red };
  const receiver = { red_input: red };
  const other = { green_input: circuit.network("green_1") };
  const alone = { red_output: null };
  circuit.add(event);
  circuit.add(receiver);
  circuit.add(other);
  circuit.add(alone);
  assert.equal(circuit.deviceId(event), "d1");
  assert.equal(circuit.receiverOf(event), null);
  circuit.setPeers(event, { receiver });
  circuit.setPeers(other, { receiver: alone });
  assert.equal(circuit.receiverOf(event), receiver);
  throwsCode(() => circuit.setPeers(event, { receiver: {} }), "not-registered");
  assert.equal(circuit.receiverOf(event), receiver);
  circuit.remove(receiver);
  assert.equal(circuit.receiverOf(event), null);
  assert.equal(circuit.receiverOf(other), alone);
  circuit.setPeers(event, { receiver: other });
  assert.equal(circuit.receiverOf(event), other);
  assert.equal(circuit.receiverOf(other), alone);
  assert.equal(circuit.devices.includes(receiver), false);
  throwsCode(() => circuit.deviceId(receiver), "not-registered");
  throwsCode(() => circuit.remove(receiver), "not-registered");
  throwsCode(() => circuit.receiverOf(receiver), "not-registered");
  const next = { red_input: red };
  circuit.add(next);
  assert.equal(circuit.deviceId(next), "d5");
  circuit.remove(event);
  assert.equal(circuit.receiverOf(other), alone);
  throwsCode(() => circuit.setPeers({}, { receiver: other }), "not-registered");
  throwsCode(() => circuit.setPeers(other, null), "invalid-peers");
  throwsCode(() => circuit.setPeers(other, "x"), "invalid-peers");
  throwsCode(() => circuit.setPeers(other, []), "invalid-peers");
  throwsCode(() => circuit.setPeers(other, {}), "invalid-peers");
  throwsCode(() => circuit.setPeers(other, { receiver: alone, extra: true }), "invalid-peers");
  throwsCode(() => circuit.setPeers(other, { other: alone }), "invalid-peers");
  throwsCode(() => circuit.setPeers(other, { receiver: null }), "not-registered");
  const portable = source({}, []);
  circuit.add(portable);
  circuit.remove(portable);
  const elsewhere = new Circuit();
  elsewhere.add(portable);
  assert.equal(elsewhere.deviceId(portable), "d1");
  assert.equal(elsewhere.devices.length, 1);
  throwsCode(() => circuit.add({ red_input: red }, "d1"), "duplicate-id");
  const reserved = circuit.reserveDeviceId();
  circuit.releaseDeviceId(reserved);
  throwsCode(() => circuit.add({ red_input: red }, reserved), "duplicate-id");
  const keptId = circuit.deviceId(next);
  const rebuilt = { red_input: red };
  circuit.replaceDevice(next, rebuilt);
  assert.equal(circuit.deviceId(rebuilt), keptId);
  throwsCode(() => circuit.releaseDeviceId(keptId), "duplicate-id");
  throwsCode(() => circuit.replaceDevice({ red_input: red }, { red_input: red }), "not-registered");
  throwsCode(() => circuit.orderDevices([rebuilt]), "invalid-order");
  await circuit.createSimulation();
  assert.equal(circuit.network("red_1"), red);
});

test("маски и выбор сетей отклоняют неверную форму", async () => {
  const circuit = new Circuit();
  const red = circuit.network("red_1");
  const green = circuit.network("green_1");
  circuit.add(source({ red_output: red }, [count(A, 1)]));
  circuit.add({ green_input: green });
  const simulation = await circuit.createSimulation();
  const ports = { red, green };
  throwsCode(() => simulation.readMask(null, both, A), "invalid-selection");
  throwsCode(() => simulation.readMask("x", both, A), "invalid-selection");
  throwsCode(() => simulation.readMask([], both, A), "invalid-selection");
  throwsCode(() => simulation.readMask({ red }, both, A), "invalid-selection");
  throwsCode(() => simulation.readMask({ red, green, extra: 1 }, both, A), "invalid-selection");
  throwsCode(() => simulation.readMask({ green, blue: null }, both, A), "invalid-selection");
  throwsCode(() => simulation.readMask({ red, blue: null }, both, A), "invalid-selection");
  throwsCode(() => simulation.readMask({ red: "red_1", green: null }, redOnly, A), "invalid-selection");
  throwsCode(() => simulation.readMask({ red: new Circuit().network("red_1"), green: null }, redOnly, A), "not-in-simulation");
  throwsCode(() => simulation.readMask({ red: green, green: null }, redOnly, A), "wrong-color");
  throwsCode(() => simulation.readMask(ports, null, A), "invalid-mask");
  throwsCode(() => simulation.readMask(ports, "x", A), "invalid-mask");
  throwsCode(() => simulation.readMask(ports, [], A), "invalid-mask");
  throwsCode(() => simulation.readMask(ports, { red: true }, A), "invalid-mask");
  throwsCode(() => simulation.readMask(ports, { red: true, green: true, extra: 1 }, A), "invalid-mask");
  throwsCode(() => simulation.readMask(ports, { green: true, blue: true }, A), "invalid-mask");
  throwsCode(() => simulation.readMask(ports, { red: true, blue: true }, A), "invalid-mask");
  throwsCode(() => simulation.readMask(ports, { red: 1, green: true }, A), "invalid-mask");
  throwsCode(() => simulation.readMask(ports, { red: true, green: "false" }, A), "invalid-mask");
  throwsCode(() => simulation.read("red_1", A), "not-in-simulation");
  throwsCode(() => simulation.present(null), "not-in-simulation");
  throwsCode(() => simulation.read(red, 1), "invalid-signal");
  throwsCode(() => simulation.presentMask(ports, { red: false, green: 1 }), "invalid-mask");
  assert.equal(simulation.readMask({ red: null, green: null }, neither, A), 0);
});
