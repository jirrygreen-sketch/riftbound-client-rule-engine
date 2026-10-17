// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-negative-error-message-must-not-leak-private-card (CR v1.5 128.4, 108.7.c)
//
// Subject: the real target layer (finalizeTargetPlan) error channel. A rejected
// private card must not surface its id, cardId, name or characteristics.
import assert from "node:assert/strict";
import test from "node:test";
import { world } from "./harness.mjs";
import { finalizeTargetPlan, TargetSelectionError } from "../../../dist/target/target-plan.js";

test("privacy-negative-error-message-must-not-leak-private-card: an illegal hand target is rejected with a generic reason", () => {
  const kernel = world()
    .player("A", { energy: 0 })
    .player("B", { energy: 0 })
    .hand("h1", { owner: "B", cardId: "card:h1", name: "Private Unit", types: ["unit"], might: 2 })
    .unit("u1", { owner: "A", cardId: "card:u1", types: ["unit"], might: 2, location: { type: "battlefield", id: "bf1" } })
    .build();

  let error;
  try {
    finalizeTargetPlan(kernel, { id: "unit", filter: { zone: "board", type: "unit" }, selection: "one" }, {
      selected: [kernel.ref("h1")], chooser: "A"
    });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof TargetSelectionError, "the illegal target is rejected");
  assert.equal(error.code, "invalid-target-choice");
  assert.equal(/h1|Private Unit|card:h1|unit/.test(error.message), false, "the message carries no private identity");
  assert.equal(kernel.getObject("h1").zone, "hand", "the rejected card never moved");
});

