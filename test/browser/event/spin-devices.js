import { EventCombinator } from "../../../src/index.js";

export class Spin extends EventCombinator {
  main() {
    while (true) {
      // Зависание проверяет остановку Worker, а не виртуальный тик.
    }
  }
}

export const devices = [Spin];
