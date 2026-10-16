import assert from "node:assert/strict";
import test from "node:test";

import program from "../../../dist/cards/sfd/riposte.js";
import { validateCardProgram } from "../../../dist/ir/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import counter from "../../../../engine-core/dist/effects/instructions/effect.counter.js";

const CARD_ID = "card.hash-6e1bdc294002f23d867897b239a644801a07effca16fc07c31ab55c7f41ff26d";

const chainSpell = (id, owner = "B", energy = 3) => ({
  zone: "chain",
  owner,
  controller: owner,
  types: ["spell"],
  cardId: id,
  energy
});

test("sfd-206-221 Riposte: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(result.value.canonicalCardId, CARD_ID);
  assert.equal(result.value.rulesetVersion, "core-1.5");
  assert.equal(result.value.status, "judge-required");
  assert.match(result.value.judgeReason, /continuous\.might/);
  assert.match(result.value.judgeReason, /RIFT-87/);
});

test("sfd-206-221 Riposte: structure — reaction keyword plus a two-target counter-then-buff play body", () => {
  assert.equal(program.abilities.length, 2);
  const [keyword, play] = program.abilities;
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 2 }
  });

  const [counterSpell, grantMight] = play.body;
  assert.equal(counterSpell.id, "counter-spell");
  assert.equal(counterSpell.op, "effect.counter");
  assert.deepEqual(counterSpell.args, { target: { kind: "constant", value: "target-spell" } });
  assert.equal(counterSpell.targets.length, 1);
  assert.deepEqual(counterSpell.targets[0], {
    id: "target-spell",
    filter: { type: "spell", zone: "chain" },
    min: 1,
    max: 1,
    selection: "one"
  });

  assert.equal(grantMight.id, "grant-might");
  assert.equal(grantMight.op, "effect.modify-might");
  assert.equal(grantMight.linkedTo, "counter-spell");
  assert.deepEqual(grantMight.args.amount, {
    kind: "linked-value",
    instructionId: "counter-spell",
    key: "counteredEnergy"
  });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.equal(grantMight.targets.length, 1);
  assert.deepEqual(grantMight.targets[0], {
    id: "target-unit",
    filter: { type: "unit", controller: "you" },
    min: 1,
    max: 1,
    selection: "one"
  });

  assert.equal(
    program.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "Choose a friendly unit and a spell. Counter that spell and give that unit " +
      "+:rb_might: equal to that spell's Energy cost this turn."
  );
});

test("sfd-206-221 Riposte: counter clause executes against a chain spell (reference kernel)", () => {
  const testWorld = world().object("enemy-spell", chainSpell("enemy-spell", "B", 3)).build();
  const spell = testWorld.ref("enemy-spell");
  const run = runInstruction(counter, { target: "target-spell" }, {
    world: testWorld,
    targets: { "target-spell": [spell] }
  });

  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked?.countered, 1);
  assert.deepEqual(run.linked?.counteredObjects, [{ id: "enemy-spell", zoneEntryId: 1 }]);
  assert.equal(testWorld.getObject("enemy-spell")?.zone, "trash");
  assert.equal(testWorld.object(spell), null);
  assert.equal(run.events[0].action, "counter");
});

test("sfd-206-221 Riposte: counter clause ignores a spell that already left the chain (359.3.e)", () => {
  const testWorld = world().object("enemy-spell", chainSpell("enemy-spell", "B", 2)).build();
  const stale = testWorld.ref("enemy-spell");
  testWorld.perform({ type: "move-zone", object: stale, to: "trash" });
  const run = runInstruction(counter, { target: "target-spell" }, {
    world: testWorld,
    targets: { "target-spell": [stale] }
  });

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.equal(testWorld.getObject("enemy-spell")?.zone, "trash");
});

test.todo("sfd-206-221 Riposte: might grant value locks the countered spell's Energy cost and lasts until end of turn (continuous.might + continuous.duration, addContinuous) — depends on RIFT-87 (continuous might/duration primitives) and the kw-reaction expansion from RIFT-83.");

test.todo("sfd-206-221 Riposte: full chain play (Reaction admission in Closed State, cost payment, became-target triggers for both targets) — depends on RIFT-84/RIFT-85 (chain admission + cost.finalized) and RIFT-83 (Reaction keyword).");
