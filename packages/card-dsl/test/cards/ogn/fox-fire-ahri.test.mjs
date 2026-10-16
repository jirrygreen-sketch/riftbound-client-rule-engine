import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/fox-fire-ahri.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-a8491bd5b3202938d1600eec9d2435158dffdf3ceda1be6ceaa50336f2e25393";

const keywords = program.abilities.filter(ability => ability.kind === "keyword");
const play = program.abilities.find(ability => ability.kind === "play");
const killInstruction = play.body[0];
const targetSpec = killInstruction.targets[0];

test("ogn-256-298 Fox-Fire: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
      "[Action] (Play on your turn or in showdowns.)\n" +
      "Kill any number of units at a battlefield with total Might 4 or less."
  );
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-256-298 Fox-Fire judgeReason names the group and total-Might gap", () => {
  assert.match(program.judgeReason, /355\.11/);
  assert.match(program.judgeReason, /total Might/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.match(program.judgeReason, /cost\.hidden/);
});

test("ogn-256-298 Fox-Fire structure: [Hidden] + [Action] and an any-number group kill", () => {
  assert.deepEqual(keywords, [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" }
  ]);
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.equal(play.body.length, 1);

  assert.equal(killInstruction.id, "fox-fire-kill");
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args.target, { kind: "literal", value: "fox-fire-units" });
  assert.equal(killInstruction.linkedTo, undefined);

  // "any number ... at a battlefield": 355.13 lets the controller choose zero
  // targets, and 355.11 makes the group need one shared battlefield plus the
  // total-Might <= 4 constraint that is still missing (see judgeReason).
  assert.equal(killInstruction.targets.length, 1);
  assert.equal(targetSpec.id, "fox-fire-units");
  assert.deepEqual(targetSpec.filter, { type: "unit", locationType: "battlefield" });
  assert.equal(targetSpec.selection, "any");
  assert.equal(targetSpec.min, 0);
  assert.equal(targetSpec.max, null);
  assert.equal(targetSpec.kind, "group");
  assert.equal(killInstruction.picks, undefined);
});

test("ogn-256-298 Fox-Fire golden: the kill half kills exactly the group members locked at Finalize", () => {
  const kernel = world()
    .unit("first-unit", { location: { type: "battlefield", id: "battlefield-1" } })
    .unit("second-unit", { location: { type: "battlefield", id: "battlefield-1" } })
    .unit("unlocked-unit", { location: { type: "battlefield", id: "battlefield-2" } })
    .build();
  const locked = [kernel.ref("first-unit"), kernel.ref("second-unit")];

  const run = runInstruction(kill, { target: targetSpec.id }, { world: kernel, targets: { [targetSpec.id]: locked } });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("first-unit").zone, "trash");
  assert.equal(kernel.getObject("second-unit").zone, "trash");
  assert.equal(kernel.getObject("unlocked-unit").zone, "board");
  assert.equal(run.events.filter(event => event.action === "kill").length, 2);
});

test("ogn-256-298 Fox-Fire golden: choosing zero units is legal for any-number targeting (355.13)", () => {
  const kernel = world().unit("untouched-unit").build();
  const run = runInstruction(kill, { target: targetSpec.id }, { world: kernel, targets: { [targetSpec.id]: [] } });

  // With an empty selection there is nothing to kill: the instruction is ignored
  // (359.3.e) and no unit dies.
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(kernel.getObject("untouched-unit").zone, "board");
  assert.equal(run.events.length, 0);
});

test.todo(
  "Fox-Fire: the 355.11 group requirement (units sharing one battlefield, total Might <= 4) and " +
    "the resolution-time legal-subset re-choice of 355.11.b belong to target-plan work (RIFT-90) — " +
    "the Core Rules use this card as the example for that rule."
);

test.todo(
  "Fox-Fire: [Hidden] Hide for a rainbow rune, the facedown zone and the free facedown play " +
    "need the cost.hidden primitive and facedown support."
);
