// RIFT-668 partial execution / boundaries: ../templates/static-668.test.mjs.
// Published status stays judge-required; existing component coverage is retained below.
// Scenario execution evidence: ../templates/static-644.test.mjs (one parameterized row per card).
// This card stays judge-required; the template row pins the executable-view lifecycle plus the
// recorded combatRole / relative-player gaps, and backs the root cause asserted below.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/crimson-pigeons.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-202a6a8d0996a1526ced8874bdc194188d33ba1a216fb691a29e5fd4a678afd7";
const SOURCE_TEXT = "I have +2 :rb_might: while I'm attacking with another unit.";

const [ability] = program.abilities;

test("unl-154-219 Crimson Pigeons: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-154-219 Crimson Pigeons: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /807\.1\.d|466\.2\.c\.3/);
  assert.match(program.judgeReason, /combat\/flow\.ts|turn\/flow\.ts/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /layers\/filter\.ts/);
  // Third-sweep refresh: the reason now records the measured count-set result
  // (relative player unresolved) and the characteristics.combatRole spelling
  // that the matcher really evaluates.
  assert.match(program.judgeReason, /characteristics\.combatRole/);
  assert.match(program.judgeReason, /controller: "controller"/);
});

test("unl-154-219 Crimson Pigeons: one static +2 Might modifier scoped to itself", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  // 143.2.a / 479.4：Might 的修正在算术层生效。
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 2 });
  assert.equal(ability.effect.appliesTo, "self");
});

test("unl-154-219 Crimson Pigeons: the 'attacking with another unit' clause is an explicit condition", () => {
  // 364.3 的条件式被动能力；807.1.d / 466.2.c.3 的攻击者身份与 740.2.c 的 in combat 定义。
  assert.equal(ability.condition.kind, "all");
  assert.equal(ability.condition.conditions.length, 2);
  const [, withAnotherAttacker] = ability.condition.conditions;
  assert.equal(withAnotherAttacker.kind, "compare");
  assert.equal(withAnotherAttacker.operator, "gte");
  assert.deepEqual(withAnotherAttacker.right, { kind: "constant", value: 1 });
  assert.equal(withAnotherAttacker.left.kind, "count");
  assert.equal(withAnotherAttacker.left.subject, "other-attacking-units");
  // “another unit”：同位置的另一个己方单位（355.9.c 的 another、740.1.a 的 friendly），
  // 且由战斗身份限定为攻击者；锚点只用契约 3.6 的符号选择器。
  assert.deepEqual(withAnotherAttacker.left.filter, {
    type: "unit",
    controller: "controller",
    zone: "board",
    sameLocationAs: "self",
    exclude: "self",
    combatRole: "attacker"
  });
});

test("unl-154-219 Crimson Pigeons: the attack set is queried by location, not by targets", () => {
  // 355.10.d：这类按特征程序化选出的集合不取目标；卡内因此没有 targets/picks，
  // 条件只用契约 3.6 的符号锚点（sameLocationAs/exclude）与 combatRole 维度描述。
  assert.equal(ability.targets, undefined);
  assert.equal(ability.picks, undefined);
  assert.equal(ability.effect.appliesTo, "self");
  // 同一位置上的“另一个单位”必须在判定时排除宿主自身（355.9.c 的 another 惯例）。
  const [, withAnotherAttacker] = ability.condition.conditions;
  assert.equal(withAnotherAttacker.left.filter.exclude, "self");
  assert.equal(withAnotherAttacker.left.filter.sameLocationAs, "self");
  // judgeReason 记录 CardProgram 快照与图层查询仍缺的接线。
  assert.match(program.judgeReason, /layers\/filter\.ts/);
});

test("unl-154-219 Crimson Pigeons boundary: the layer filter ignores combatRole, so a defender satisfies the attacker clause (CR 466.2.c.3)", () => {
  // Re-probed 2026-10-17: layers/filter.ts is the matcher used by the static
  // binder and the layer engine, and it never reads combatRole. A defender — and
  // even an undesignated unit — therefore satisfies the authored
  // `combatRole: "attacker"` restriction, which would grant +2 Might wrongly.
  const [selfAttacking, withAnotherAttacker] = ability.condition.conditions;
  assert.deepEqual(withAnotherAttacker.left.filter.combatRole, "attacker");
  const kernel = world()
    .unit("attacker", { combatRole: "attacker", might: 3 })
    .unit("defender", { combatRole: "defender", might: 3 })
    .unit("undesignated", { combatRole: null, might: 3 })
    .build();
  for (const id of ["attacker", "defender", "undesignated"]) {
    assert.equal(matchesObjectFilter({ combatRole: "attacker" }, kernel.getObject(id)), true);
  }
  assert.equal(selfAttacking.left.property, "combatRole");
});

test("unl-154-219 Crimson Pigeons boundary: the authored relative filter matches no object, so the 'another unit' count is 0", () => {
  // Third-sweep evidence for the refreshed judgeReason, measured against the
  // production static binder plus layer engine. programs/statics.ts stores
  // controller:"controller" verbatim and layers/filter.ts compares that literal
  // against each object's controller value, so the "another unit you control"
  // set is empty even with a same-location friendly attacker present.
  const [, withAnotherAttacker] = ability.condition.conditions;
  const authored = withAnotherAttacker.left.filter;
  assert.equal(authored.controller, "controller");

  const conditionFor = filter => ({
    ...ability.condition,
    conditions: [
      ability.condition.conditions[0],
      { ...withAnotherAttacker, left: { ...withAnotherAttacker.left, filter } }
    ]
  });
  // The reference kernel supplies combatRole, which production combat never
  // assigns (contract 3.8) and a zone change would clear.
  const unit = (id, overrides = {}) => ({
    ref: { id, zoneEntryId: 1 }, cardId: null, name: id, types: ["unit"], tags: [], keywords: [],
    owner: "A", controller: "A", zone: "board", location: { type: "battlefield", id: "bf-1" },
    might: 3, energy: null, power: null, exhausted: false, damage: 0, stunned: false,
    buffs: 0, attachedTo: null, faceDown: false, isToken: false, combatRole: "attacker",
    ...overrides
  });
  const evaluate = (filter, ally) => {
    const board = fixture({ cards: [] });
    board.kernel.addObject(unit("pigeons", { cardId: program.canonicalCardId }));
    if (ally) board.kernel.addObject(ally);
    const host = board.kernel.getObject("pigeons");
    createEngineStaticBinder(board.engine).bindStatic({ ...ability, condition: conditionFor(filter) }, host);
    board.engine.layers.setObjects(board.kernel.objects);
    const [entry] = board.engine.layers.registry.list();
    return entry.effect.effect.condition(host);
  };

  const friendlyAttacker = unit("ally", { might: 2 });
  const friendlyDefender = unit("ally", { might: 2, combatRole: "defender" });
  const distantAttacker = unit("ally", { might: 2, location: { type: "battlefield", id: "bf-2" } });

  // Authored spelling: the literal "controller" gate rejects every candidate,
  // so even a same-location friendly attacker leaves the count at 0.
  assert.equal(evaluate(authored, friendlyAttacker), false);
  assert.equal(evaluate(authored, null), false);
  // Resolving the player by hand makes the count reach 1, which shows the
  // blocker is the relative player and not the location anchor: selectors.ts
  // really consumes sameLocationAs/exclude, so a distant ally still fails.
  const literalController = { ...authored, controller: "A" };
  assert.equal(evaluate(literalController, friendlyAttacker), true);
  assert.equal(evaluate(literalController, distantAttacker), false);
  assert.equal(evaluate(literalController, null), false);
  // ...but then blocker (2) shows up: the layer matcher never reads a combatRole
  // key, so a defender ally satisfies the "attacker" filter too.
  assert.equal(evaluate(literalController, friendlyDefender), true);
  // characteristics.combatRole is the spelling the matcher really evaluates.
  const characteristics = (({ combatRole, ...rest }) => ({ ...rest, characteristics: { combatRole } }))(literalController);
  assert.equal(evaluate(characteristics, friendlyAttacker), true);
  assert.equal(evaluate(characteristics, friendlyDefender), false);
});

test("unl-154-219 Crimson Pigeons boundary: the static ability binds, but the condition's relative filter has no production consumer", () => {
  // The +2 Might declaration itself reaches the real static binder. The
  // condition it carries cannot be evaluated truthfully: nothing assigns
  // combatRole in production combat, and the layer filter compares the
  // controller placeholder literally (CR 355.9.c / 359.3.f). This test pins the
  // binding half so the remaining gap stays attributable to those two points.
  const board = fixture({
    cards: [
      { id: "pigeons", cardId: program.canonicalCardId, types: ["unit"], might: 3 },
      { id: "ally", types: ["unit"], might: 2 }
    ]
  });
  const binder = createEngineStaticBinder(board.engine);
  const handle = binder.bindStatic(ability, board.kernel.getObject("pigeons"));
  assert.equal(typeof handle.unbind, "function");
  assert.equal(board.engine.layers.registry.list().length, 1);
  // The layer engine does evaluate the ability condition on the bound source,
  // but the matcher it queries with compares `controller: "controller"`
  // literally against the unit's controller id, so the friendly unit is filtered
  // out and the count is zero: the +2 stays off even with a friendly unit at the
  // same battlefield. The combatRole gap is pinned in the previous test.
  board.engine.layers.setObjects(board.kernel.objects);
  assert.equal(board.engine.layers.snapshot(board.kernel.ref("pigeons")).might, 3);
  handle.unbind();
});

test("unl-154-219 Crimson Pigeons golden: the printed self-attack gate rejects a defender or an undesignated host", () => {
  assert.equal(ability.condition.kind, "all");
  const [selfAttacking] = ability.condition.conditions;
  assert.deepEqual(selfAttacking, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "combatRole" },
    operator: "eq",
    right: { kind: "constant", value: "attacker" }
  });
  for (const combatRole of ["attacker", "defender", null]) {
    const initial = world().unit("pigeons", { might: 3, combatRole }).build();
    const kernel = initial.clone({ sourceSnapshot: initial.getObject("pigeons") });
    const outcome = resolveChainBody([{
      id: "check-self-attacking",
      op: "condition.predicate",
      args: { condition: { kind: "constant", value: selfAttacking } }
    }], kernel);
    assert.equal(outcome.status, "executed");
    assert.equal(outcome.linkedValues["check-self-attacking.value"], combatRole === "attacker");
    assert.equal(kernel.getObject("pigeons").might, 3);
    assert.deepEqual(outcome.events, []);
  }
});
