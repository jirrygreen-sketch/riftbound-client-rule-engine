import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/forbidding-waste.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createProgramBinding, createEngineStaticBinder } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { queryObjects } from "../../../../engine-core/dist/effects/interpreter/selectors.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
const CANONICAL = "card.hash-62355f7fd2699dda34a1601a315ab1ee9095ff67da700d49567b54955780324f";
const SOURCE_TEXT =
  "While a unit here is defending alone, it has -2 :rb_might:. " +
  "(It's alone if there are no other friendly units here.)";

const [ability] = program.abilities;
const [defending, alone] = ability.condition.conditions;

test("unl-210-219 Forbidding Waste: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("unl-210-219 Forbidding Waste: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The two surviving gaps are the Defender designation producer and the
  // layer-filter "here"/friendly-count path; static->layer registration is
  // merged (see the binder golden below) and no longer named as a gap.
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /abilityEnvironment/);
  assert.ok(!/RIFT-257/.test(program.judgeReason));
  // Third-sweep refresh: the reason now records the measured anchor behavior
  // (both anchors ignored, controller:"self" always true) and the fact that the
  // placeholder expression is truthy, not a defending predicate.
  assert.match(program.judgeReason, /对字面量恒真/);
  assert.match(program.judgeReason, /都被忽略/);
  assert.doesNotMatch(program.judgeReason, /RIFT-124/);
});

test("unl-210-219 Forbidding Waste: one static arithmetic -2 Might for units here", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");

  // 479.4/479.4.e.1: a Might reduction is an arithmetic-layer effect; the
  // merged engine applies increases before decreases.
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: -2 });

  // 053.3/199.1: "here" is this Battlefield; the layer filter does not
  // implement the anchor (the judged gap).
  assert.deepEqual(ability.effect.filter, {
    type: "unit",
    zone: "board",
    sameLocationAs: "self"
  });
});

test("unl-210-219 Forbidding Waste: the conditional passive gate is defending + alone", () => {
  // 364.3/364.3.a: "While …" is a Conditional Passive Ability.
  assert.equal(ability.condition.kind, "all");
  assert.equal(ability.condition.conditions.length, 2);

  // 814.1.d/466.2.c.3: the unit holds the Defender designation during Combat;
  // the merged combat flow never sets contract §3.8’s combatRole.
  assert.deepEqual(defending, {
    kind: "expression",
    value: { kind: "constant", value: "self-is-defending" }
  });

  // 740.2.a: alone = no other friendly units at the same location. The
  // parenthetical only restates the definition (135.2.b).
  assert.equal(alone.kind, "compare");
  assert.equal(alone.operator, "eq");
  assert.deepEqual(alone.right, { kind: "constant", value: 0 });
  assert.equal(alone.left.kind, "count");
  assert.equal(alone.left.subject, "other-friendly-units-here");
  assert.deepEqual(alone.left.filter, {
    type: "unit",
    zone: "board",
    controller: "self",
    sameLocationAs: "self",
    exclude: "self"
  });
});

test("unl-210-219 Forbidding Waste: the merged static binder installs the -2 as an arithmetic ContinuousEffectSpec", () => {
  // RIFT-257/RIFT-91 registration is merged: bindStatic turns the card's own
  // static ability into a registered layer effect with the "here" anchor
  // resolved to the source's absolute location (programs/statics.ts).
  const f = fixture({ cards: [{ id: "waste", cardId: CANONICAL, types: ["battlefield"] }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("waste"), to: "battlefield", location: { type: "battlefield", id: "battlefield-1" } });
  f.engine.advance();
  const binding = createProgramBinding({ cardPrograms: [program] });
  const source = f.kernel.getObject("waste");
  const ability = binding.inspect(source).abilities.find(item => item.kind === "static");
  const handle = createEngineStaticBinder(f.engine).bindStatic(ability, source);
  const [entry] = f.engine.layers.registry.list();
  assert.equal(entry.effect.layer, "arithmetic");
  assert.equal(entry.effect.effect.kind, "continuous.might");
  // The binder literal() flattens constant Exprs into layer-usable numbers.
  assert.equal(entry.effect.effect.amount, -2);
  assert.deepEqual(entry.effect.filter.location, { type: "battlefield", id: "battlefield-1" });
  handle.unbind();
  assert.equal(f.engine.layers.registry.list().length, 0);
});

test("unl-210-219 Forbidding Waste boundary: the static query's filter syntax ignores the here/alone anchors (CR 740.2.a)", () => {
  // Third-sweep evidence for gap (2): layers/filter.ts — the matcher the static
  // binder's abilityEnvironment uses — ignores sameLocationAs and exclude and
  // treats controller:"self" as a match-all, so the authored filter matches
  // every unit on the Board instead of "other friendly units here".
  const kernel = world()
    .unit("defender", { controller: "A", combatRole: "defender" })
    .unit("friend-here", { controller: "A" })
    .unit("enemy-elsewhere", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-2" } })
    .build();
  const matched = kernel.objects.filter(object => matchesObjectFilter(alone.left.filter, object)).map(object => object.ref.id);
  assert.ok(matched.includes("defender"));
  assert.ok(matched.includes("friend-here"), "the here/exclude anchors are ignored, so distant or excluded units still match");
  assert.ok(matched.includes("enemy-elsewhere"), "controller:self is a match-all in this matcher, so even enemies match");
  assert.equal(matchesObjectFilter({ type: "unit", controller: "self" }, kernel.getObject("enemy-elsewhere")), true);
  // The interpreter's selector path does understand the anchors, which is why
  // the gap is the static query wiring rather than the anchor vocabulary.
  // selectors.ts resolves both anchors there; a literal controller is used so the
  // assertion isolates the anchor behavior (the surrounding player selector is
  // normalized by the chain context, not by this direct query).
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("defender") });
  const otherFriendly = queryObjects({ ...alone.left.filter, controller: "A" }, {
    context, host: context.source.ref, linked: () => undefined, canLookBack: () => true, isIgnored: () => false
  }).map(object => object.ref.id);
  assert.deepEqual(otherFriendly, ["friend-here"], "selectors.ts excludes the host itself and distant/enemy units");
});

test("unl-210-219 Forbidding Waste boundary: the 'is defending' placeholder is truthy for any unit (CR 814.1.d)", () => {
  // Third-sweep evidence for gap (1): contract §3.8's combatRole has no combat
  // producer, and the placeholder expression the card uses to record the intent
  // evaluates the literal string as truthy, so it cannot stand in for a real
  // defender predicate.
  assert.deepEqual(defending, {
    kind: "expression",
    value: { kind: "constant", value: "self-is-defending" }
  });
  const kernel = world().unit("attacker", { controller: "A", combatRole: "attacker" }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("attacker") });
  const environment = {
    context, host: context.source.ref, linked: () => undefined, canLookBack: () => true, isIgnored: () => false
  };
  // The literal is a non-empty string, so this evaluates TRUE for an attacker:
  // the placeholder is not a defending predicate and must not be promoted.
  assert.equal(evaluateCondition(defending, environment), true);
  assert.equal(context.object(context.source.ref).combatRole, "attacker");
});

test("unl-210-219 Forbidding Waste boundary: even a lone real defender keeps full Might (CR 476/479.4)", () => {
  // Third-sweep evidence for gap (3): the binder resolves sameLocationAs:self to
  // a structured LocationRef, but the layer filter compares it by reference
  // identity (with only a type-string fallback), so the -2 never reaches even a
  // unit standing on the same Battlefield.
  const board = fixture({ cards: [
    { id: "waste", cardId: CANONICAL, types: ["battlefield"], controller: "A", location: { type: "battlefield", id: "bf-1" } },
    { id: "defender", types: ["unit"], might: 4, controller: "A", location: { type: "battlefield", id: "bf-1" }, combatRole: "defender" }
  ] });
  for (const id of ["waste", "defender"]) {
    board.engine.commit({ type: "move-zone", object: board.kernel.ref(id), to: "board", location: { type: "battlefield", id: "bf-1" } });
  }
  const defender = board.kernel.getObject("defender");
  defender.combatRole = "defender";
  board.kernel.restore(board.kernel.snapshot());
  const source = board.kernel.getObject("waste");
  createEngineStaticBinder(board.engine).bindStatic(ability, source);
  const [entry] = board.engine.layers.registry.list();
  assert.deepEqual(entry.effect.filter.location, { type: "battlefield", id: "bf-1" });
  assert.equal(matchesObjectFilter(entry.effect.filter, board.kernel.getObject("defender")), false,
    "the resolved LocationRef does not equal the object's own location object");
  board.engine.layers.setObjects(board.kernel.objects);
  assert.equal(board.engine.layers.evaluate(board.kernel.ref("defender")).might, 4);
});
