import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/firelights-hideout.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL =
  "card.hash-b0fa1aa611f78286913c3002834a073dcdd58ad0678ff45714b3accf84b68c72";
const SOURCE_TEXT =
  "When you conquer here, the next unit you play this turn has [Accelerate]. " +
  "(You may pay :rb_energy_1: and a Power of its Domain as an additional cost to have it enter ready.)";

const [ability] = program.abilities;
const [grant] = ability.body;

test("rad-162-167 Firelights' Hideout: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("rad-162-167 Firelights' Hideout: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous.grant-keyword/);
  assert.match(program.judgeReason, /one-shot/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("rad-162-167 Firelights' Hideout: conquer trigger at the 'here' battlefield for its controller", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "conquer");
  // 053.3 "here" + 190.6.d "you": the sibling battlefield programs keep the
  // same placeholder spelling while the trigger pipeline is unmerged.
  assert.deepEqual(ability.trigger.filter, {
    event: "conquer",
    here: true,
    player: "controller"
  });
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.trigger.condition, undefined);
});

test("rad-162-167 Firelights' Hideout: the grant names Accelerate, this turn and the next unit", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "firelights-hideout.grant-accelerate"
  ]);
  assert.equal(grant.op, "continuous.grant-keyword");
  assert.deepEqual(grant.args.keyword, { kind: "constant", value: "Accelerate" });
  // The printed grant lasts for this turn (Duration end-of-turn vocabulary);
  // the one-shot "next unit" window itself has no IR shape (judgeReason).
  assert.deepEqual(grant.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(grant.args.appliesTo, {
    kind: "constant",
    value: { target: "firelights-hideout.next-unit" }
  });

  assert.equal(grant.targets.length, 1);
  const [target] = grant.targets;
  assert.equal(target.id, "firelights-hideout.next-unit");
  // 805.1.a: Accelerate is present on Units; "you" is the controller. The
  // "next" quantifier is not expressible, so min stays 0 — the shape must not
  // invent a target that does not exist when the ability finalizes.
  assert.deepEqual(target.filter, { type: "unit", controller: "controller" });
  assert.equal(target.min, 0);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "up-to");
});

test("rad-162-167 Firelights' Hideout: the card never declares Accelerate on the Battlefield", () => {
  // 805.1.a: Accelerate is a Unit keyword. The Battlefield grants it to a later
  // unit; declaring it as its own keyword ability would change what the card
  // says (and would make the battlefield itself look like a unit).
  assert.equal(
    program.abilities.some(value => value.kind === "keyword"),
    false
  );
  assert.equal(grant.args.keyword.value, "Accelerate");
});

test("rad-162-167 Firelights' Hideout: the granted Accelerate cost is the +1 power optional additional cost", () => {
  // 805.1.b / 805.2: paying the granted Accelerate cost is what makes the unit
  // enter ready. The merged Accelerate keyword definition is the single source
  // of that cost (effects/keywords/Accelerate.ts), so the golden test asserts
  // that the merged definition still declares exactly the printed optional
  // cost instead of re-implementing it here.
  const single = { canonicalCardId: "unittest-accelerate" };
  return import("../../../../engine-core/dist/effects/keywords/Accelerate.js").then(({ default: accelerate }) => {
    assert.equal(accelerate.keyword, "Accelerate");
    assert.equal(accelerate.valued, false);
    assert.equal(accelerate.stacking, "single");
    const expanded = accelerate.expand({ host: single });
    const cost = expanded[0].effect.cost;
    assert.equal(cost.kind, "additional-cost");
    assert.equal(cost.optional, true);
    assert.equal(cost.payments[0].kind, "energy");
    assert.deepEqual(cost.payments[0].amount, { kind: "constant", value: 1 });
    assert.equal(cost.payments[1].kind, "power");
    assert.deepEqual(cost.payments[1].amount, { kind: "constant", value: 1 });
  });
});

test("rad-162-167 Firelights' Hideout: the merged layers engine cannot apply the declared effect", () => {
  // The grant is a continuous effect, so the layer engine is the consumer that
  // would have to apply it. Two merged behaviours make the declaration
  // unusable as written, so the card must not be treated as executable. This
  // test pins the current behaviour instead of assuming the scope works.
  const unit = (id, locationId) => ({
    ref: { id, zoneEntryId: 1 },
    cardId: "card:" + id,
    name: id,
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: locationId },
    might: 3,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false,
  });
  const here = unit("unit-here", "bf-1");
  const elsewhere = unit("unit-elsewhere", "bf-2");
  const declaredFilter = { type: "unit", controller: "controller", sameLocationAs: "self" };
  const effect = {
    id: "firelights-grant",
    layer: "ability",
    source: here.ref,
    filter: declaredFilter,
    effect: { kind: "grant-keyword", keyword: "Accelerate" },
  };
  const engine = createLayerEngine([here, elsewhere], [
    { effect, duration: { type: "permanent" } },
  ]);

  // 1. The declared filter never matches: the merged filter compares
  //    controller literally, so the "controller" placeholder cannot resolve to
  //    the ability's controller and no unit receives the grant at all.
  assert.deepEqual(engine.evaluate(here.ref).keywords, []);
  assert.deepEqual(engine.evaluate(elsewhere.ref).keywords, []);

  // 2. 053.3 "here" is not honoured either: dropping only the controller
  //    placeholder applies the grant to units at every Battlefield, because
  //    merged filters ignore sameLocationAs (another over-application, not a
  //    fix).
  const unscoped = { ...effect, id: "firelights-grant-unscoped", filter: { type: "unit", sameLocationAs: "self" } };
  const unscopedEngine = createLayerEngine([here, elsewhere], [
    { effect: unscoped, duration: { type: "permanent" } },
  ]);
  assert.deepEqual(
    unscopedEngine.evaluate(here.ref).keywords.map(keyword => keyword.id),
    ["Accelerate"]
  );
  assert.deepEqual(
    unscopedEngine.evaluate(elsewhere.ref).keywords.map(keyword => keyword.id),
    ["Accelerate"],
    "sameLocationAs is ignored, so the grant leaks to other Battlefields"
  );
});

test.todo(
  "rad-162-167 Firelights' Hideout: install the granted [Accelerate] on the next unit the " +
    "controller plays this turn, assert the 1-energy-plus-Domain-power optional cost is offered " +
    "at that play and that entering ready follows payment (805.1.b/805.2/805.2.b) — needs " +
    "continuous.grant-keyword / continuous.keyword registration and the one-shot next-unit " +
    "window (RIFT-91 follow-up, same gap as ogn/raging-firebrand)"
);

test.todo(
  "rad-162-167 Firelights' Hideout: subscribe the conquer trigger and resolve it for the " +
    "Battlefield's controller (383.4.c.2.b, 190.6.d) — needs scoring → chain/events conquer " +
    "emission and CardProgram TriggerRegistration (RIFT-31/RIFT-33, contract §7.2 batch 5)"
);

