import { EventCombinator } from "../../../src/index.js";

export class Later extends EventCombinator {
  main() {
    return Promise.resolve().then(() => {
      this.state.late = true;
    });
  }
}

export const devices = [Later];
