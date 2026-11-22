import { EventCombinator, Signal } from "../../../src/index.js";

const A = Signal.Signals.signal_A;

export class HoldPulse extends EventCombinator {
  init() {
    this.setOutput({
      red: true,
      green: false,
      signals: [{ signal: A, constant: 2 }],
    });
    this.wakeAt(0);
  }

  main() {
    if (this.tick === 0) {
      this.pulse({
        red: true,
        green: false,
        signals: [{ signal: A, constant: 3 }],
      }, 2);
    }
  }
}

export const devices = [HoldPulse];
