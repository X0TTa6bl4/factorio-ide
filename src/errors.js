/** Ошибка конфигурации схемы. `code` стабилен для тестов и диагностики. */

export class ConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ConfigError";
    this.code = code;
  }
}

/** Ошибка выполнения тика. Опубликованная граница при ней не меняется. */

export class RuntimeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RuntimeError";
    this.code = code;
  }
}
