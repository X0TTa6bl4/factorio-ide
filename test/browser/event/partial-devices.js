import { EventCombinator, Signal } from "../../../src/index.js";

const A = Signal.Signals.signal_A;

export class First extends EventCombinator {
  init() {
    this.state.n = 1;
    this.wakeAt(5);
    this.setOutput({
      red: true,
      green: false,
      signals: [{ signal: A, constant: 2 }],
    });
  }

  main() {
    this.state.n = 9;
    this.setOutput({
      red: true,
      green: false,
      signals: [{ signal: A, constant: 9 }],
    });
  }
}

export class Second extends EventCombinator {
  main() {
    while (true) {}
  }
}

export const devices = [First, Second];
