/** Сборка модуля сценария и жизненный цикл страницы. Главный поток код сценария не исполняет. */

import { Circuit } from "./circuit.js";
import { ConfigError, RuntimeError } from "./errors.js";
import { EventCombinator } from "./event.js";
import { cloneRuntimeJson } from "./json-value.js";

const STOPPED = "Исполнитель сценария остановлен";

function classLine() {
  return /^[ \t]*export[ \t]+class[ \t]+([A-Za-z_$][\w$]*)[ \t]+extends[ \t]+EventCombinator\b/gm;
}

function failResult(code, message) {
  return { ok: false, code, message };
}

function spaces(count) {
  return " ".repeat(count);
}

function skipLineComment(source, index) {
  let cursor = index;
  while (cursor < source.length && source[cursor] !== "\n") cursor += 1;
  return cursor;
}

function skipBlockComment(source, index) {
  const end = source.indexOf("*/", index + 2);
  return end === -1 ? source.length : end + 2;
}

function skipQuoted(source, index) {
  const quote = source[index];
  let cursor = index + 1;
  while (cursor < source.length) {
    if (source[cursor] === "\\") {
      cursor += cursor + 1 < source.length ? 2 : 1;
      continue;
    }
    if (source[cursor] === "\n") break;
    if (source[cursor] === quote) return cursor + 1;
    cursor += 1;
  }
  return cursor;
}

function maskTemplate(source, index) {
  let text = " ";
  let cursor = index + 1;
  while (cursor < source.length) {
    if (source[cursor] === "\\") {
      const take = cursor + 1 < source.length ? 2 : 1;
      text += spaces(take);
      cursor += take;
      continue;
    }
    if (source[cursor] === "$" && source[cursor + 1] === "{") {
      const expressionEnd = skipTemplateExpression(source, cursor + 1);
      text += "  ";
      text += maskTrivia(source.slice(cursor + 2, expressionEnd));
      if (expressionEnd < source.length) {
        text += " ";
        cursor = expressionEnd + 1;
      } else {
        cursor = expressionEnd;
      }
      continue;
    }
    if (source[cursor] === "`") return { text: `${text} `, end: cursor + 1 };
    text += " ";
    cursor += 1;
  }
  return { text, end: source.length };
}

function skipTemplateExpression(source, braceIndex) {
  let depth = 0;
  let cursor = braceIndex;
  while (cursor < source.length) {
    if (source.startsWith("//", cursor)) {
      cursor = skipLineComment(source, cursor);
      continue;
    }
    if (source.startsWith("/*", cursor)) {
      cursor = skipBlockComment(source, cursor);
      continue;
    }
    const quote = source[cursor];
    if (quote === "'" || quote === '"') {
      cursor = skipQuoted(source, cursor);
      continue;
    }
    if (quote === "`") {
      cursor = maskTemplate(source, cursor).end;
      continue;
    }
    if (quote === "{") depth += 1;
    if (quote === "}") {
      depth -= 1;
      if (depth === 0) return cursor;
    }
    cursor += 1;
  }
  return source.length;
}

function maskTrivia(source) {
  let text = "";
  let cursor = 0;
  while (cursor < source.length) {
    if (source.startsWith("//", cursor)) {
      const end = skipLineComment(source, cursor);
      text += spaces(end - cursor);
      cursor = end;
      continue;
    }
    if (source.startsWith("/*", cursor)) {
      const end = skipBlockComment(source, cursor);
      text += spaces(end - cursor);
      cursor = end;
      continue;
    }
    const quote = source[cursor];
    if (quote === "'" || quote === '"') {
      const end = skipQuoted(source, cursor);
      text += spaces(end - cursor);
      cursor = end;
      continue;
    }
    if (quote === "`") {
      const masked = maskTemplate(source, cursor);
      text += masked.text;
      cursor = masked.end;
      continue;
    }
    text += source[cursor];
    cursor += 1;
  }
  return text;
}

export function compileScenarioSource(source, engineHref) {
  if (typeof source !== "string") return failResult("invalid-script", "Текст сценария должен быть строкой");
  if (typeof engineHref !== "string" || engineHref === "") {
    return failResult("invalid-script", "Адрес движка должен быть непустой строкой");
  }
  if (source.trim() === "") return failResult("invalid-script", "Сценарий пуст");
  const masked = maskTrivia(source);
  if (/^\s*import\b/m.test(masked) || /\bimport\s*\(/.test(masked)) {
    return failResult("invalid-script", "Импорт добавляет страница: в сценарии доступны EventCombinator и Signal");
  }
  const matches = [...masked.matchAll(classLine())];
  if (matches.length !== 1) {
    return failResult("invalid-script", "Нужен один export class Имя extends EventCombinator");
  }
  const match = matches[0];
  const withoutClass = `${masked.slice(0, match.index)}${spaces(match[0].length)}${masked.slice(match.index + match[0].length)}`;
  if (/\bexport\b/.test(withoutClass)) {
    return failResult("invalid-script", "Экспортируйте только класс сценария");
  }
  const className = match[1];
  const replacement = `class ${className} extends EventCombinator`;
  const body = `${source.slice(0, match.index)}${replacement}${source.slice(match.index + match[0].length)}`;
  const moduleSource = `${body}\nexport const devices = [${className}];\nimport { EventCombinator, Signal } from ${JSON.stringify(engineHref)};\n`;
  return { ok: true, className, moduleSource };
}

export function readTimeoutMs(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    return failResult("invalid-executor", "Лимит исполнителя должен быть целым числом от 1 мс");
  }
  return { ok: true, timeoutMs: value };
}

export function readScenarioSettings({ everyTick, inputChanged, stateText }) {
  if (typeof everyTick !== "boolean" || typeof inputChanged !== "boolean") {
    return failResult("invalid-run", "Режим запуска задаётся логическими everyTick и inputChanged");
  }
  if (typeof stateText !== "string") {
    return failResult("invalid-state", "Начальное состояние должно быть текстом JSON");
  }
  let parsed;
  try {
    parsed = stateText.trim() === "" ? {} : JSON.parse(stateText);
  } catch {
    return failResult("invalid-state", "Начальное состояние не является JSON");
  }
  try {
    return {
      ok: true,
      run: { every_tick: everyTick, input_changed: inputChanged },
      state: cloneRuntimeJson(parsed),
    };
  } catch (error) {
    return failResult("invalid-state", error.message);
  }
}

export function formatDiagnostic(error) {
  const code = error && typeof error.code === "string" && error.code !== "" ? error.code : "script-error";
  const message = error instanceof Error ? error.message : String(error);
  const deviceId = error && error.deviceId !== undefined && error.deviceId !== null ? String(error.deviceId) : "";
  const tick = error && error.tick !== undefined && error.tick !== null ? String(error.tick) : "";
  const location = error && typeof error.location === "string" ? error.location : "";
  return { code, message, deviceId, tick, location };
}

function asError(result) {
  if (result.code === "invalid-run" || result.code === "invalid-executor") {
    return new ConfigError(result.code, result.message);
  }
  return new RuntimeError(result.code, result.message);
}

function workerStopped() {
  return new RuntimeError("worker-stopped", STOPPED);
}

class EventScriptSession {
  #engineHref;
  #openExecutor;
  #status = "idle";
  #revision = 0;
  #dirty = false;
  #stopped = false;
  #flight = null;
  #intent = null;
  #diagnostic = null;
  #inner = null;
  #release = null;
  #moduleSource = "";
  #timeoutMs = 1000;
  #className = "";
  #settings = null;
  #circuit = null;
  #simulation = null;
  #device = null;
  #red = null;
  #green = null;
  #memory = null;
  #facade;

  constructor(engineHref, openExecutor) {
    this.#engineHref = engineHref;
    this.#openExecutor = openExecutor;
    this.#facade = {
      replayInit: true,
      prepare: (request) => this.#prepare(request),
    };
  }

  view() {
    const simulation = this.#simulation;
    const published = simulation ? simulation.device(this.#device) : null;
    return {
      status: this.#flight ? "busy" : this.#status,
      revision: this.#revision,
      runId: simulation ? simulation.runId : null,
      tick: simulation ? simulation.tick : null,
      className: this.#className,
      shell: "EventCombinator",
      dirty: this.#dirty,
      diagnostic: this.#diagnostic,
      canStep: Boolean(simulation) && !this.#flight && !this.#dirty && !this.#stopped,
      canReset: Boolean(simulation) && !this.#dirty,
      canStop: Boolean(simulation) && !this.#dirty,
      canCheck: !this.#flight,
      canRemember: Boolean(simulation) && !this.#flight && !this.#dirty,
      canRestore: Boolean(this.#memory) && !this.#flight && !this.#dirty,
      red: simulation ? simulation.present(this.#red) : [],
      green: simulation ? simulation.present(this.#green) : [],
      state: published ? published.state : null,
      messages: published ? published.messages : [],
      rememberedTick: this.#memory ? this.#memory.tick : null,
    };
  }

  setTimeoutMs(value) {
    const timeout = readTimeoutMs(value);
    if (!timeout.ok) throw asError(timeout);
    this.#timeoutMs = timeout.timeoutMs;
  }

  noteEdit() {
    this.#dirty = true;
    if (this.#flight) {
      this.#intent = "edit";
      this.#halt();
      return;
    }
    if (this.#simulation) this.#status = "paused";
  }

  async check(input) {
    if (this.#flight) return this.#throw(new RuntimeError("step-busy", "Шаг уже выполняется"));
    const done = this.#openFlight();
    try {
      await this.#check(input);
      done.resolve();
    } catch (error) {
      done.reject(error);
      throw error;
    } finally {
      this.#flight = null;
      this.#intent = null;
    }
    return this.view();
  }

  async step() {
    if (this.#flight) return this.#throw(new RuntimeError("step-busy", "Шаг уже выполняется"));
    this.#assertRunnable();
    if (this.#stopped) return this.#throw(workerStopped());
    const done = this.#openFlight();
    try {
      await this.#step();
      done.resolve();
    } catch (error) {
      done.reject(error);
      throw error;
    } finally {
      this.#flight = null;
      this.#intent = null;
    }
    return this.view();
  }

  async reset() {
    if (this.#flight) {
      this.#assertRunnable();
      this.#intent = "reset";
      this.#halt();
      await this.#flight;
      return this.view();
    }
    this.#assertRunnable();
    try {
      await this.#simulation.reset();
    } catch (error) {
      if (error && (error.code === "timeout" || error.code === "worker-stopped")) {
        await this.#finishReset();
        return this.view();
      }
      return this.#pause(error);
    }
    this.#status = "ready";
    this.#diagnostic = null;
    return this.view();
  }

  async stop() {
    if (!this.#simulation || this.#dirty) {
      return this.#throw(new RuntimeError("run-paused", "Нет прогона для остановки"));
    }
    if (this.#flight) {
      this.#intent = "stop";
      this.#halt();
      await this.#flight;
      return this.view();
    }
    this.#halt();
    await this.#finishStop();
    return this.view();
  }

  remember() {
    if (this.#flight) return this.#throw(new RuntimeError("step-busy", "Шаг уже выполняется"));
    this.#assertRunnable();
    this.#memory = this.#simulation.capture();
    return this.#memory.tick;
  }

  async restore() {
    if (this.#flight) return this.#throw(new RuntimeError("step-busy", "Шаг уже выполняется"));
    this.#assertRunnable();
    if (!this.#memory) return this.#throw(new RuntimeError("invalid-snapshot", "Нет запомненной границы"));
    await this.#simulation.restore(this.#memory);
    this.#status = "ready";
    this.#diagnostic = null;
    return this.view();
  }

  async #check(input) {
    const timeout = readTimeoutMs(input.timeoutMs);
    if (!timeout.ok) return this.#keep(timeout);
    const compiled = compileScenarioSource(input.source, this.#engineHref);
    if (!compiled.ok) return this.#keep(compiled);
    const settings = readScenarioSettings(input);
    if (!settings.ok) return this.#keep(settings);
    this.#halt();
    this.#simulation = null;
    this.#device = null;
    this.#memory = null;
    let opened;
    try {
      opened = await this.#openExecutor(compiled.moduleSource, timeout.timeoutMs);
    } catch (error) {
      this.#status = "failed";
      this.#diagnostic = formatDiagnostic(error);
      throw error;
    }
    this.#adopt(opened, timeout.timeoutMs, compiled);
    this.#settings = settings;
    try {
      this.#installCircuit();
      this.#simulation = await this.#circuit.createSimulation({ executor: this.#facade });
    } catch (error) {
      this.#halt();
      this.#status = "failed";
      this.#diagnostic = formatDiagnostic(error);
      throw error;
    }
    this.#revision += 1;
    this.#dirty = false;
    this.#status = "ready";
    this.#diagnostic = null;
    return this.view();
  }

  async #step() {
    try {
      await this.#simulation.step();
    } catch (error) {
      return this.#afterFailure(error);
    }
    this.#status = "ready";
    this.#diagnostic = null;
    return this.view();
  }

  async #afterFailure(error) {
    if (this.#intent === "edit") return this.#edited();
    if (this.#intent === "reset") return this.#finishReset();
    if (this.#intent === "stop") return this.#finishStop();
    if (error && (error.code === "timeout" || error.code === "worker-stopped")) {
      try {
        await this.#finishStop();
      } catch (reviveError) {
        this.#status = "failed";
        this.#diagnostic = formatDiagnostic(reviveError);
        throw reviveError;
      }
    }
    return this.#pause(error);
  }

  #edited() {
    this.#status = "paused";
    return this.#throw(new RuntimeError(
      "run-paused",
      "Прогон остановлен: сценарий изменён, прежний ответ не применяется",
    ));
  }

  async #finishStop() {
    const snapshot = this.#simulation.capture();
    try {
      await this.#replaceWorker();
      await this.#simulation.restore(snapshot);
    } catch (error) {
      this.#stopped = true;
      this.#status = "failed";
      this.#diagnostic = formatDiagnostic(error);
      throw error;
    }
    this.#status = "paused";
    this.#diagnostic = null;
    return this.view();
  }

  async #finishReset() {
    try {
      await this.#replaceWorker();
      await this.#simulation.reset();
    } catch (error) {
      this.#stopped = true;
      this.#status = "failed";
      this.#diagnostic = formatDiagnostic(error);
      throw error;
    }
    this.#status = "ready";
    this.#dirty = false;
    this.#diagnostic = null;
    return this.view();
  }

  async #replaceWorker() {
    const opened = await this.#openExecutor(this.#moduleSource, this.#timeoutMs);
    this.#adopt(opened, this.#timeoutMs, { moduleSource: this.#moduleSource, className: this.#className });
  }

  #adopt(opened, timeoutMs, compiled) {
    const previous = this.#release;
    this.#release = typeof opened.release === "function" ? opened.release : () => {};
    this.#inner = opened.executor;
    this.#stopped = false;
    this.#timeoutMs = timeoutMs;
    this.#moduleSource = compiled.moduleSource;
    this.#className = compiled.className;
    previous?.();
  }

  #installCircuit() {
    const circuit = new Circuit();
    const red = circuit.network("red_1");
    const green = circuit.network("green_1");
    const device = new EventCombinator({
      red_input: red,
      green_input: green,
      red_output: red,
      green_output: green,
      state: this.#settings.state,
      run: this.#settings.run,
    });
    circuit.add(device);
    this.#circuit = circuit;
    this.#device = device;
    this.#red = red;
    this.#green = green;
  }

  #openFlight() {
    let resolve;
    let reject;
    const flight = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    flight.catch(() => {});
    this.#flight = flight;
    return { resolve, reject };
  }

  #prepare(request) {
    const inner = this.#inner;
    return Promise.resolve(inner.prepare(request)).then((response) => {
      if (this.#stopped) throw workerStopped();
      return response;
    });
  }

  #halt() {
    this.#stopped = true;
    if (this.#inner && typeof this.#inner.stop === "function") this.#inner.stop();
  }

  #assertRunnable() {
    if (!this.#simulation || this.#dirty) {
      this.#throw(new RuntimeError("run-paused", "Сначала проверьте сценарий"));
    }
  }

  #keep(result) {
    this.#status = this.#simulation ? "paused" : "failed";
    return this.#throw(asError(result));
  }

  #pause(error) {
    this.#status = "paused";
    if (error && (error.code === "timeout" || error.code === "worker-stopped")) {
      if (error.tick === undefined) error.tick = this.#simulation.tick;
      if (error.deviceId === undefined) error.deviceId = this.#circuit.deviceId(this.#device);
    }
    return this.#throw(error);
  }

  #throw(error) {
    this.#diagnostic = formatDiagnostic(error);
    throw error;
  }
}

export function createEventScriptSession({ engineHref, openExecutor }) {
  if (typeof engineHref !== "string" || engineHref === "") {
    throw new ConfigError("invalid-script", "Адрес движка должен быть непустой строкой");
  }
  if (typeof openExecutor !== "function") {
    throw new ConfigError("invalid-executor", "Нужна функция openExecutor");
  }
  return new EventScriptSession(engineHref, openExecutor);
}
