import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/deathgrip.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [, play] = program.abilities;
const killInstruction = play.body[0];
const mightInstruction = play.body[1];
const drawInstruction = play.body[2];

test("Deathgrip program is valid EffectIR v2 data and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(
    program.canonicalCardId,
    "card.hash-1f41363528139c43d205b49bf3880604480befbe9f8d033db61f0618cecdf389"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might|Might 修正/);
  assert.match(program.judgeReason, /RIFT-83\/84|RIFT-91/);
  assert.equal(
    program.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "Kill a friendly unit to give +:rb_might: equal to its Might to another friendly unit this turn. Draw 1."
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Deathgrip structure: [Reaction], kill cost as a pick, linked Might grant, unlinked draw", () => {
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "reaction" });
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["deathgrip.kill", "effect.kill"],
      ["deathgrip.grant-might", "effect.might-modify"],
      ["deathgrip.draw", "effect.draw"]
    ]
  );

  // "Kill a friendly unit to ...": a cost inside the instruction
  // (355.10.c.1), so the killed unit is a non-target pick.
  assert.equal(killInstruction.targets, undefined);
  assert.deepEqual(killInstruction.args.picks, { kind: "constant", value: "deathgrip.fodder" });
  assert.equal(killInstruction.picks.length, 1);
  const [fodder] = killInstruction.picks;
  assert.equal(fodder.id, "deathgrip.fodder");
  assert.equal(fodder.selection, "one");
  assert.equal(fodder.min, 1);
  assert.equal(fodder.max, 1);
  assert.deepEqual(fodder.filter, { type: "unit", controller: "controller" });

  // "give +[M] equal to its Might to another friendly unit this turn": the
  // amount reads the Might of the unit the kill instruction links, and the
  // granted unit is a target that excludes the fodder.
  assert.equal(mightInstruction.linkedTo, "deathgrip.kill");
  assert.deepEqual(mightInstruction.args.amount, {
    kind: "object-property",
    object: { linked: "deathgrip.kill" },
    property: "might"
  });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(mightInstruction.targets.length, 1);
  assert.equal(mightInstruction.targets[0].id, "deathgrip.gifted-unit");
  assert.deepEqual(mightInstruction.targets[0].filter, {
    type: "unit",
    controller: "controller",
    exclude: { pick: "deathgrip.fodder" }
  });

  // "Draw 1." is a separate sentence and is NOT linked to the Might grant
  // (359.3.e.11: an impossible Might grant still draws).
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(drawInstruction.targets, undefined);
});

test("Deathgrip golden: the kill cost executes through the non-target pick", () => {
  const kernel = world()
    .unit("fodder", { owner: "A", might: 3 })
    .unit("ally", { owner: "A", might: 2 })
    .build();
  const picked = kernel.ref("fodder");
  const run = runInstruction(kill, { picks: "deathgrip.fodder" }, {
    world: kernel,
    picks: { "deathgrip.fodder": [picked] }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.killed, [picked]);
  assert.equal(kernel.getObject("fodder").zone, "trash");
  assert.equal(kernel.getObject("ally").zone, "board");
});

test("Deathgrip golden: the linked amount reads the killed unit's Might through look-back", () => {
  // 359.3.e.13: the spell moved the unit out of the Board, so its last-known
  // Might is still readable through the reference the kill instruction linked.
  const kernel = world()
    .unit("fodder", { owner: "A", might: 3 })
    .unit("ally", { owner: "A", might: 2 })
    .build();
  kernel.setPicks("deathgrip.fodder", [kernel.ref("fodder")]);
  const outcome = runAbilityBody([
    killInstruction,
    {
      id: "might-probe",
      op: "condition.value",
      args: {
        value: mightInstruction.args.amount,
        key: { kind: "constant", value: "killedMight" }
      }
    }
  ], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.linkedValues["might-probe.killedMight"], 3);
});

test("Deathgrip golden: the linked Might instruction is ignored when the cost cannot be paid", () => {
  // The merged interpreter propagates an ignored (mistargeted) kill to the
  // linked instruction (359.3.e.14.a / contract 3.4) before the unregistered
  // Might op is ever dispatched.
  const kernel = world().unit("fodder", { owner: "A", might: 3 }).build();
  const stale = kernel.ref("fodder");
  kernel.perform({ type: "return-to-hand", object: stale });
  kernel.setPicks("deathgrip.fodder", [stale]);
  const outcome = runAbilityBody([killInstruction, mightInstruction], kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(outcome.results[1].result, { status: "ignored", reason: "linked-ignored" });
});

test("Deathgrip golden: the independent Draw 1 draws when the Might half cannot resolve", () => {
  const kernel = world().deck(["top-card", "next-card"]).build();
  const run = runInstruction(draw, { amount: drawInstruction.args.amount }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
});

test.todo(
  "Deathgrip Might grant: +[M] equal to the killed unit's Might applied to another friendly " +
    "unit this turn (CR 359.3.e.13 look-back for the amount, 122.5-style temporary modification) " +
    "(依赖 layers 的 continuous.might 原语，RIFT-83/84、RIFT-91)"
);

test.todo(
  "Deathgrip end-to-end: [Reaction] timing admission, the kill cost at Finalize, and the " +
    "two instructions resolving top to bottom through the chain (813 / 355 / 359.3.e.14)"
);
