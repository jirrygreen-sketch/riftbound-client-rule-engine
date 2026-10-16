import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/challenge.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-27cf1792f7bb4da955117bb4a15cb33f4e4705984cacfac9055a2884b061e4e1";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Choose a friendly unit and an enemy unit. They deal damage equal to their Mights to each other.";

const speed = program.abilities[0];
const play = program.abilities[1];
const [friendlyDeals, enemyDeals] = play.body;

// The reference kernel compares filter values literally, so the friendly/enemy
// placeholders are bound as finalized targets (the production target pipeline
// resolves them at Finalize, RIFT-90). The TargetSpecs stay in the program and
// are asserted structurally; the body runs without re-declaring them.
const bodyWithoutTargetSpecs = play.body.map(({ targets, ...rest }) => rest);

test("Challenge program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Challenge identity, status and printed text match the catalog", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("Challenge structure: [Action] keyword and two targeted, unlinked Deal instructions", () => {
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });

  assert.equal(play.kind, "play");
  assert.deepEqual(play.body.map(instruction => instruction.id), ["friendly-deals", "enemy-deals"]);

  // "Choose a friendly unit and an enemy unit": both Board units are chosen
  // specifically, so both are Targets (355.7 / 355.9.a.1). Each instruction
  // names the unit it damages; the other unit is already declared here.
  assert.deepEqual(friendlyDeals.targets, [{
    id: "enemy-unit",
    filter: { type: "unit", controller: "opponent" },
    min: 1,
    max: 1,
    selection: "one"
  }]);
  assert.deepEqual(enemyDeals.targets, [{
    id: "friendly-unit",
    filter: { type: "unit", controller: "self" },
    min: 1,
    max: 1,
    selection: "one"
  }]);
  assert.deepEqual(friendlyDeals.args.target, { kind: "constant", value: "enemy-unit" });
  assert.deepEqual(enemyDeals.args.target, { kind: "constant", value: "friendly-unit" });
});

test("Challenge structure: each unit is the damage source and the amount is its Might", () => {
  // 418.6.b.3 names this card: the damage is dealt by the chosen units, whose
  // controllers are responsible (418.6.b.4). Might is read at resolution.
  for (const [instruction, self, other] of [
    [friendlyDeals, "friendly-unit", "enemy-unit"],
    [enemyDeals, "enemy-unit", "friendly-unit"]
  ]) {
    assert.deepEqual(instruction.args.amount, {
      kind: "object-property",
      object: { target: self },
      property: "might"
    });
    assert.deepEqual(instruction.args.source, {
      kind: "object-property",
      object: { target: self },
      property: "ref"
    });
    assert.deepEqual(instruction.args.target, { kind: "constant", value: other });
    // A fixed per-unit amount is not 355.14 split damage, and the printed
    // Deal is not combat damage (418.6.c), so neither flag is declared.
    assert.equal(instruction.args.divide, undefined);
    assert.equal(instruction.args.combat, undefined);
    // The two Deal actions are not one linked instruction pair: neither
    // references the other's result (359.3.e.14).
    assert.equal(instruction.linkedTo, undefined);
  }
});

test("Challenge golden: the two chosen units damage each other by their Mights", () => {
  const kernel = world()
    .unit("challenger", { owner: "A", might: 3 })
    .unit("defender", { owner: "B", might: 5 })
    .build();
  kernel.setTargets("friendly-unit", [kernel.ref("challenger")]);
  kernel.setTargets("enemy-unit", [kernel.ref("defender")]);
  // 418.6.b.3 makes each chosen unit the source of its own damage; the
  // submitted GameActions are observed (a hook that applies no replacement)
  // to prove the source references, not just the marked damage.
  const submitted = [];
  kernel.addReplacement(action => {
    if (action.type === "damage") submitted.push(action);
    return null;
  });

  const outcome = resolveChainBody(bodyWithoutTargetSpecs, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => result.result.status), ["executed", "executed"]);
  // 418.1.b/.c: damage is marked on each unit separately; 418.6.b.3 makes each
  // chosen unit the source of its own damage.
  assert.equal(kernel.getObject("challenger").damage, 5);
  assert.equal(kernel.getObject("defender").damage, 3);
  assert.deepEqual(submitted, [
    {
      type: "damage",
      source: kernel.ref("challenger"),
      target: kernel.ref("defender"),
      amount: 3,
      combat: false
    },
    {
      type: "damage",
      source: kernel.ref("defender"),
      target: kernel.ref("challenger"),
      amount: 5,
      combat: false
    }
  ]);
  assert.deepEqual(outcome.results[0].result.linkedValues.dealtTo, [
    { target: kernel.ref("defender"), amount: 3 }
  ]);
  assert.deepEqual(outcome.results[1].result.linkedValues.dealtTo, [
    { target: kernel.ref("challenger"), amount: 5 }
  ]);
  const sources = outcome.events.map(event => event.action).filter(action => action === "damage");
  assert.equal(sources.length, 2);
});

test("Challenge golden: Might is read at resolution, after an intervening change", () => {
  // Contract 3.6: value expressions are evaluated when used. The defender
  // was 1 Might over, now 4; the damage follows the current Might.
  const kernel = world()
    .unit("challenger", { owner: "A", might: 1 })
    .unit("defender", { owner: "B", might: 4 })
    .build();
  kernel.setTargets("friendly-unit", [kernel.ref("challenger")]);
  kernel.setTargets("enemy-unit", [kernel.ref("defender")]);

  const outcome = resolveChainBody(bodyWithoutTargetSpecs, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("challenger").damage, 4);
  assert.equal(kernel.getObject("defender").damage, 1);
});

test("Challenge golden: a stale enemy target ignores both Deal instructions", () => {
  // CR 359.3.e.7/.12: with the chosen unit gone the Might check and the damage
  // that targets it are both ignored, never replaced by last known values.
  const kernel = world()
    .unit("challenger", { owner: "A", might: 3 })
    .unit("defender", { owner: "B", might: 5 })
    .build();
  const stale = kernel.ref("defender");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  kernel.setTargets("friendly-unit", [kernel.ref("challenger")]);
  kernel.setTargets("enemy-unit", [stale]);

  const outcome = resolveChainBody(bodyWithoutTargetSpecs, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(result => result.result), [
    { status: "ignored", reason: "mistargeted" },
    { status: "ignored", reason: "mistargeted" }
  ]);
  assert.equal(kernel.getObject("challenger").damage, 0);
  assert.equal(outcome.events.length, 0);
});

test.todo(
  "Challenge: [Action] admission plus Finalize-time targeting of one friendly and " +
    "one enemy unit (355.3/355.5, became-target events) belongs to the chain and the " +
    "target system (RIFT-90)."
);

test.todo(
  "Challenge: killing a lethally damaged unit happens in the next Cleanup, not during " +
    "resolution (320/321, 323.4), so a unit that dies to this spell is still available " +
    "as a damage source in the same resolution; the real kernel owns that sequencing."
);
