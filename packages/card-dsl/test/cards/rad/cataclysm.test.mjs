import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/cataclysm.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-ae044cb9c1012d147e7d25ce802c5abdf9385203d5b3e53601d79a9d830f8472";
const SOURCE_TEXT =
  "Opponents can't play spells this turn.\n" +
  "Move a friendly unit to an occupied enemy battlefield.";

const [play] = program.abilities;
const [restriction, moveInstruction] = play.body;

test("Cataclysm program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Cataclysm identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The judgeReason must name the actual gaps: the continuous.restrict
  // consumer and the runtime Location selector, not a generic complaint.
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Cataclysm structure: printed cost, descriptive restriction, targeted Move", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  // Catalog printing: 4 energy + 1 Body power, no Action/Reaction keyword.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 4 },
    power: { kind: "constant", value: 1 }
  });
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["cataclysm.no-opponent-spells", "continuous.restrict"],
      ["cataclysm.move-unit", "effect.move"]
    ]
  );

  // "Opponents can't play spells this turn" is a descriptive prohibition:
  // the op is not registered, so it cannot silently become executable.
  assert.equal(restriction.args.action.value, "play-spell");
  assert.equal(restriction.args.appliesTo.value, "opponent");
  assert.equal(restriction.args.duration.value, "this-turn");

  // "Move a friendly unit to an occupied enemy battlefield": the moved unit
  // is a target (355.10 / 355.9.a.1); the destination is a runtime battlefield
  // choice (170.11.a occupied) and is described, not executed.
  assert.equal(moveInstruction.linkedTo, undefined);
  assert.deepEqual(moveInstruction.args.objects, {
    kind: "constant",
    value: { target: "cataclysm.friendly-unit" }
  });
  assert.deepEqual(moveInstruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(moveInstruction.args.to.value.kind, "destination-selector");
  assert.equal(moveInstruction.targets.length, 1);
  assert.equal(moveInstruction.targets[0].id, "cataclysm.friendly-unit");
  assert.deepEqual(moveInstruction.targets[0].filter, {
    type: "unit",
    controller: "controller"
  });
  assert.equal(moveInstruction.targets[0].min, 1);
  assert.equal(moveInstruction.targets[0].max, 1);
  assert.equal(moveInstruction.targets[0].selection, "one");
});

test("Cataclysm fail-closed: the unregistered restriction op throws instead of being approximated", () => {
  const kernel = world().unit("friendly").unit("enemy", { owner: "B" }).build();
  kernel.setTargets("cataclysm.friendly-unit", [kernel.ref("friendly")]);
  // The first printed clause has no merged primitive. The interpreter must
  // fail closed rather than skip the prohibition and move a unit anyway.
  assert.throws(() => runAbilityBody(play.body, kernel), /Unregistered instruction opcode: continuous\.restrict/);
  assert.deepEqual(kernel.getObject("friendly").location, { type: "battlefield", id: "battlefield-1" });
});

test.todo(
  "Cataclysm: 'Opponents can't play spells this turn' needs the continuous.restrict prohibition " +
    "consumer (CR 204.4-style applied limits, chain canAct) — RIFT-91 / RIFT-120 follow-up"
);

test.todo(
  "Cataclysm: moving a friendly unit to an occupied enemy battlefield needs the runtime Location " +
    "selector and the 355.4 / 451.1 destination restrictions — RIFT-90 / RIFT-91"
);
