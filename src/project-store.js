/** Локальный каталог схем. Импорт в память сюда не пишет. */

import { ConfigError } from "./errors.js";
import { readProject } from "./project-document.js";

const INDEX_KEY = "f-logic.projects.v1";
const RECORD_PREFIX = "f-logic.project.v1.";
const OPTIONS = new Set(["recordId", "replace"]);

function fail(code, message) {
  throw new ConfigError(code, message);
}

function isQuota(error) {
  const name = String(error?.name ?? "");
  return name === "QuotaExceededError"
    || name === "NS_ERROR_DOM_QUOTA_REACHED"
    || error?.code === 22
    || error?.code === 1014;
}

function storageError(error) {
  if (isQuota(error)) {
    return new ConfigError("storage-quota", "Локальное хранилище переполнено. Рабочая схема и прежняя запись не изменены.");
  }
  return new ConfigError("storage-unavailable", "Локальное хранилище недоступно. Рабочая схема остаётся в памяти.");
}

function recordKey(id) {
  return `${RECORD_PREFIX}${id}`;
}

function nextRecordId(records) {
  const taken = new Set(records.map((item) => item.id));
  let number = 1;
  while (taken.has(`p${number}`)) number += 1;
  return `p${number}`;
}

export function createProjectStore(storage) {
  function requireStorage() {
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function" || typeof storage.removeItem !== "function") {
      fail("storage-unavailable", "Локальное хранилище недоступно. Рабочая схема остаётся в памяти.");
    }
  }

  function readRaw(key) {
    try {
      return storage.getItem(key);
    } catch (error) {
      throw storageError(error);
    }
  }

  function writeRaw(key, value) {
    try {
      storage.setItem(key, value);
    } catch (error) {
      throw storageError(error);
    }
  }

  function restoreRaw(key, previous) {
    try {
      if (previous === null) storage.removeItem(key);
      else storage.setItem(key, previous);
    } catch {
      // Первая запись уже отвергнута самим хранилищем; откат второй не должен затирать её повторной ошибкой.
    }
  }

  function readIndex() {
    const raw = readRaw(INDEX_KEY);
    if (raw === null || raw === "") return { records: [] };
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      fail("invalid-store", "Каталог хранилища повреждён");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.records)) {
      fail("invalid-store", "Каталог хранилища повреждён");
    }
    return {
      records: parsed.records.map((item) => {
        if (!item || typeof item.id !== "string" || typeof item.name !== "string") {
          fail("invalid-store", "Каталог хранилища повреждён");
        }
        return { id: item.id, name: item.name };
      }),
    };
  }

  function targetId(index, name, options) {
    for (const key of Object.keys(options)) {
      if (!OPTIONS.has(key)) fail("invalid-project", `Неизвестный параметр сохранения ${key}`);
    }
    const replace = Object.hasOwn(options, "replace") ? options.replace : false;
    if (typeof replace !== "boolean") fail("invalid-project", "replace должен быть boolean");
    const requested = Object.hasOwn(options, "recordId") ? options.recordId : null;
    if (requested !== null && (typeof requested !== "string" || !/^p[1-9][0-9]*$/.test(requested))) {
      fail("invalid-id", "ID записи имеет вид pN");
    }
    const owner = index.records.find((item) => item.name === name);
    if (owner && owner.id !== requested && !replace) {
      const error = new ConfigError("name-collision", `Имя «${name}» уже сохранено. Запись не заменена.`);
      error.recordId = owner.id;
      error.projectName = name;
      throw error;
    }
    if (owner && owner.id !== requested && replace) return owner.id;
    if (requested) return requested;
    return nextRecordId(index.records);
  }

  return {
    list() {
      requireStorage();
      return readIndex().records.map((item) => ({ id: item.id, name: item.name }));
    },
    read(recordId) {
      requireStorage();
      if (typeof recordId !== "string" || !/^p[1-9][0-9]*$/.test(recordId)) {
        fail("invalid-id", "ID записи имеет вид pN");
      }
      const raw = readRaw(recordKey(recordId));
      if (raw === null) fail("missing-record", `Запись ${recordId} не найдена`);
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        fail("invalid-store", "Запись хранилища повреждена");
      }
      if (!parsed || parsed.id !== recordId || !parsed.document) {
        fail("invalid-store", "Запись хранилища повреждена");
      }
      const project = readProject(parsed.document);
      return { recordId, document: project.document };
    },
    save(document, options = {}) {
      requireStorage();
      if (!options || typeof options !== "object" || Array.isArray(options)) {
        fail("invalid-project", "Параметры сохранения должны быть объектом");
      }
      const project = readProject(document);
      const index = readIndex();
      const id = targetId(index, project.document.name, options);
      const key = recordKey(id);
      const previousRecord = readRaw(key);
      const previousIndex = readRaw(INDEX_KEY);
      const records = index.records.filter((item) => item.id !== id);
      records.push({ id, name: project.document.name });
      records.sort((left, right) => Number(left.id.slice(1)) - Number(right.id.slice(1)));
      const nextRecord = JSON.stringify({ id, document: project.document });
      const nextIndex = JSON.stringify({ records });
      try {
        writeRaw(key, nextRecord);
      } catch (error) {
        throw error;
      }
      try {
        writeRaw(INDEX_KEY, nextIndex);
      } catch (error) {
        restoreRaw(key, previousRecord);
        restoreRaw(INDEX_KEY, previousIndex);
        throw error;
      }
      return { recordId: id, name: project.document.name };
    },
  };
}
