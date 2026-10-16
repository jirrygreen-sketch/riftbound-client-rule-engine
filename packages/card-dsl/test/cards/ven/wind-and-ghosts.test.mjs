import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/wind-and-ghosts.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import banish from "../../../../engine-core/dist/effects/instructions/effect.banish.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-0ee067030c4b375395ac5d95f7243ff4e4e3a7cbb6f6147ab14d3e2b30998d9f";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Choose a unit at a battlefield. If it has 3 :rb_might: or less, banish it. " +
  "Otherwise, return it to its owner's hand.";

const [actionKeyword, play] = program.abilities;
const [banishIfSmall, returnOtherwise] = play.body;
const [unitSpec] = banishIfSmall.targets;
const [returnUnitSpec] = returnOtherwise.targets;

const UNIT_ID = "wind-and-ghosts.unit";

const banishedWithLockedTarget = (kernel, ref) =>
  runInstruction(banish, { objects: { kind: "constant", value: { target: UNIT_ID } } }, {
    world: kernel,
    targets: { [UNIT_ID]: [ref] }
  });

const returnedWithLockedTarget = (kernel, ref) =>
  runInstruction(zone, { target: UNIT_ID, to: { kind: "constant", value: "hand" }, amount: { kind: "constant", value: 1 } }, {
    world: kernel,
    targets: { [UNIT_ID]: [ref] }
  });

test("ven-106-166 Wind and Ghosts: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-106-166 Wind and Ghosts: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-106-166 Wind and Ghosts: judgeReason names the Might threshold and condition-wiring gaps", () => {
  assert.match(program.judgeReason, /mightLte/);
  assert.match(program.judgeReason, /143\.2\.a/);
  assert.match(program.judgeReason, /RIFT-83\/RIFT-91/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.match(program.judgeReason, /不近似实现/);
});

test("ven-106-166 Wind and Ghosts: [Action] keyword, printed cost and two mutually exclusive branches", () => {
  assert.equal(program.abilities.length, 2);
  // 806.1 / 159.2.a: [Action] is a permissive keyword; only the identity is
  // declared (README section 5), the permission belongs to Action.ts / chain.
  assert.deepEqual(actionKeyword, { kind: "keyword", keyword: "action" });

  assert.equal(play.kind, "play");
  // Printed 3 Energy + 1 Chaos Power (catalog energy=3, power=1, domains ["Chaos"]).
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 },
    power: { kind: "constant", value: 1 }
  });
  assert.deepEqual(play.body.map(instruction => [instruction.id, instruction.op]), [
    ["wind-and-ghosts.banish-if-small", "effect.banish"],
    ["wind-and-ghosts.return-otherwise", "effect.zone"]
  ]);

  // 355.7 / 355.9.a.1 / 355.9.b: "a unit at a battlefield" is one Board unit
  // and the battlefield is only a targeting restriction (355.10.b).
  assert.deepEqual(unitSpec, {
    id: UNIT_ID,
    filter: { type: "unit", zone: "board", location: "battlefield" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.deepEqual(returnUnitSpec, {
    id: UNIT_ID,
    filter: { type: "unit", zone: "board", location: "battlefield" },
    min: 1,
    max: 1,
    selection: "one"
  });

  // 428.1 / 428.2: banishing moves the permanent to its owner's Banishment; the
  // target is the unit selected by the first sentence's choice.
  assert.deepEqual(banishIfSmall.args.objects, {
    kind: "constant",
    value: { target: UNIT_ID }
  });
  assert.deepEqual(banishIfSmall.args.amount, { kind: "constant", value: 1 });
  assert.equal(banishIfSmall.linkedTo, undefined);

  // "Otherwise, return it to its owner's hand": a zone change (448.2) whose
  // destination is the owner's hand, routed by the action layer (108.1).
  assert.deepEqual(returnOtherwise.args.target, { kind: "constant", value: UNIT_ID });
  assert.deepEqual(returnOtherwise.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(returnOtherwise.args.amount, { kind: "constant", value: 1 });
  assert.equal(returnOtherwise.linkedTo, undefined);
});

test("ven-106-166 Wind and Ghosts: the two branches are the same Might comparison and its negation", () => {
  // Contract 3.4: a condition scopes exactly its own instruction; "Otherwise"
  // is the same comparison negated, so exactly one branch can apply. The
  // comparison itself reads the target's effective Might (143.2.a), whose
  // layer/condition wiring is the gap named in judgeReason.
  const comparison = {
    kind: "compare",
    left: {
      kind: "object-property",
      object: { target: UNIT_ID },
      property: "might"
    },
    operator: "lte",
    right: { kind: "constant", value: 3 }
  };
  assert.deepEqual(banishIfSmall.condition, comparison);
  assert.deepEqual(returnOtherwise.condition, { kind: "not", condition: comparison });
});

test("ven-106-166 Wind and Ghosts golden: the banish branch sends the unit to its owner's Banishment (428.1)", () => {
  const kernel = world()
    .unit("small-unit", { owner: "B", controller: "B", might: 2, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const run = banishedWithLockedTarget(kernel, kernel.ref("small-unit"));

  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.zone("B", "banishment").map(ref => ref.id), ["small-unit"]);
  assert.equal(kernel.getObject("small-unit").zone, "banishment");
  assert.deepEqual(run.events.map(event => event.action), ["banish"]);
  assert.equal(run.linked.banished.count, 1);
  assert.deepEqual(run.linked.banished.objects, [{ id: "small-unit", zoneEntryId: 2 }]);
});

test("ven-106-166 Wind and Ghosts golden: the return branch sends the unit to its OWN owner's hand (108.1)", () => {
  const kernel = world()
    .unit("big-unit", { owner: "B", controller: "B", might: 6, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const run = returnedWithLockedTarget(kernel, kernel.ref("big-unit"));

  assert.equal(run.result.status, "executed");
  // Even though the caster controls the spell, the unit returns to its owner's
  // hand: the zone change routes by owner (108.1 / 123).
  assert.deepEqual(kernel.objectsInZone("B", "hand").map(ref => ref.id), ["big-unit"]);
  assert.deepEqual(kernel.objectsInZone("A", "hand"), []);
  assert.equal(kernel.getObject("big-unit").zone, "hand");
  assert.deepEqual(run.events.map(event => event.action), ["return-to-hand"]);
});

test("ven-106-166 Wind and Ghosts golden: a target that left the Board is ignored (359.3.e.7)", () => {
  const kernel = world()
    .unit("gone-unit", { owner: "B", controller: "B", might: 2, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const stale = kernel.ref("gone-unit");
  // The unit changes zones before resolution, so the old zone-bound reference is
  // unusable and neither branch executes.
  kernel.perform({ type: "return-to-hand", object: stale });

  const banished = banishedWithLockedTarget(kernel, stale);
  assert.deepEqual(banished.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(banished.events, []);

  const returned = returnedWithLockedTarget(kernel, stale);
  assert.deepEqual(returned.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(returned.events, []);
  assert.equal(kernel.getObject("gone-unit").zone, "hand");
});

test.todo(
  "ven-106-166 Wind and Ghosts: enforce the 'Might 3 or less' targeting restriction with effective Might " +
    "(CR 143.2.a / 355.9.b) — no merged Might predicate exists (RIFT-83/RIFT-91) and unknown filter keys are " +
    "silently ignored, so any unit would be a legal target"
);

test.todo(
  "ven-106-166 Wind and Ghosts: decide the branch from the selected unit's layer-computed Might and its " +
    "negation (CR 143.2.a, contract 3.4) — the CardProgram condition pipeline is not wired to the layers " +
    "engine (RIFT-90/RIFT-91), so neither branch can be claimed executable end to end"
);
