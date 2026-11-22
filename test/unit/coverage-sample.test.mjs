import assert from "node:assert/strict";
import test from "node:test";
import { calledMarker } from "../../dev/sample/executed.js";

test("образец покрытия исполняется", () => {
  assert.equal(calledMarker(), "executed");
});
