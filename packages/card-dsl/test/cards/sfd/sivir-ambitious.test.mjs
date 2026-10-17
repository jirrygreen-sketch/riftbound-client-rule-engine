import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/sivir-ambitious.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import { buildCostPlan, payCostPlan, DUEL_DOMAINS } from "../../../../engine-core/dist/cost/index.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL = "card.hash-4a74e3934f4bc0ee5d6d8c70c0b3f9df97cdfcc7c158bf1473bb64daa8aade48";
const SOURCE_TEXT =
  "[Deflect 2] (Opponents must pay :rb_rune_rainbow::rb_rune_rainbow: to choose me with a spell or Ability.)\n" +
  "When I conquer after an attack, if you assigned 5 or more excess damage to enemy units, you may deal that much to an enemy unit.";

const [keyword, conquerTrigger] = program.abilities;
const [mayDeal] = conquerTrigger.body;
const [readExcess, dealDamage] = mayDeal.args.body.value;

test("sfd-120-221 Sivir, Ambitious: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-120-221 Sivir, Ambitious: judgeReason names the excess-damage, conquer-host payload and tax gaps", () => {
  assert.match(program.judgeReason, /467\.2\.c\.4/);
  assert.match(program.judgeReason, /HistoryQuery/);
  assert.match(program.judgeReason, /conquer/);
  assert.match(program.judgeReason, /383\.4\.c\.2\.a/);
  assert.match(program.judgeReason, /Deflect/);
  assert.match(program.judgeReason, /conquered/);
  assert.match(program.judgeReason, /objectId/);
  assert.match(program.judgeReason, /征服宿主/);
  assert.match(program.judgeReason, /135\.2\.e\.5\.a/);
  assert.match(program.judgeReason, /809\.1\.c\/809\.1\.c\.1/);
});

test("sfd-120-221 Sivir, Ambitious: [Deflect 2] is declared with its printed value, not expanded", () => {
  // 809.1.c/809.1.c.1: Deflect 2 costs two Power of any Domain
  // to choose this unit; 809.2 makes multiple instances sum.
  assert.deepEqual(keyword, { kind: "keyword", keyword: "deflect", value: 2 });
  assert.equal(deflect.keyword, "Deflect");
  assert.equal(deflect.valued, true);
  assert.equal(deflect.stacking, "sum");
  assert.ok(deflect.ruleRefs.includes("809.1.b.1"));
});

test("sfd-120-221 Sivir, Ambitious: 'when I conquer after an attack' carries the excess-damage condition on the trigger", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(conquerTrigger.kind, "triggered");
  // 383.4.c / 383.4.c.2.a: a Conquer Effect on the conquer timing point, put on
  // the Chain after the Conquer action when this unit took part in it.
  assert.equal(conquerTrigger.trigger.at, "conquer");
  assert.deepEqual(conquerTrigger.trigger.filter, { event: "conquered", filter: { source: "self" } });

  // 383.2.a.1: the "if you assigned …" clause immediately follows the trigger
  // condition, so it belongs to the TriggerSpec and is checked before the Chain;
  // 467.2.c.4 defines excess damage as the assignment above lethal.
  const condition = conquerTrigger.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  // The statistic has no evaluable read path, so the condition reads the
  // declared source characteristic and fails closed instead of approximating
  // the total with an object count.
  assert.deepEqual(condition.left, {
    kind: "object-property",
    object: "source",
    property: "excessDamageAssignedThisCombat"
  });
  assert.deepEqual(condition.right, { kind: "constant", value: 5 });

  assert.equal(conquerTrigger.optional, false);
});

test("sfd-120-221 Sivir, Ambitious: the may-shape reads the assigned total, then deals exactly that much", () => {
  assert.deepEqual(conquerTrigger.body.map((instruction) => instruction.id), ["sivir-ambitious.may-deal"]);
  assert.equal(mayDeal.op, "choice.optional");
  assert.equal(mayDeal.args.body.kind, "constant");
  assert.deepEqual(mayDeal.args.body.value.map((instruction) => instruction.id), [
    "sivir-ambitious.read-excess-damage",
    "sivir-ambitious.deal-that-much"
  ]);

  // "that much" is a dynamic amount, never a fixed 5: the program declares the
  // missing read position (a source characteristic) and consumes it through the
  // interpreter's linked-value mechanism. Until the statistic is wired the read
  // throws MissingInformation and both instructions ignore, instead of dealing
  // a wrong amount.
  assert.equal(readExcess.op, "condition.value");
  assert.deepEqual(readExcess.args.value, {
    kind: "object-property",
    object: "source",
    property: "excessDamageAssignedThisCombat"
  });
  assert.deepEqual(readExcess.args.key, { kind: "constant", value: "excessDamage" });
  assert.equal(readExcess.linkedTo, undefined);

  assert.equal(dealDamage.op, "effect.damage");
  assert.deepEqual(dealDamage.args.amount, {
    kind: "linked-value",
    instructionId: "sivir-ambitious.read-excess-damage",
    key: "excessDamage"
  });
  assert.deepEqual(dealDamage.args.target, {
    kind: "constant",
    value: "sivir-ambitious.enemy-unit"
  });
  assert.equal(dealDamage.linkedTo, "sivir-ambitious.read-excess-damage");
  // 418.6.a: no source is named, so the ability source deals the damage; the
  // printed deal is not combat damage (418.6.c), so no combat flag is authored.
  assert.equal(dealDamage.args.source, undefined);
  assert.equal(dealDamage.args.combat, undefined);
  // 740.1.b: "enemy" = controlled by an opponent; 355.9.a.1: Board units.
  assert.deepEqual(dealDamage.targets, [
    {
      id: "sivir-ambitious.enemy-unit",
      filter: { type: "unit", controller: "opponent", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(mayDeal.targets, undefined);
  assert.equal(mayDeal.picks, undefined);
  assert.equal(mayDeal.linkedTo, undefined);
});

test.todo(
  "sfd-120-221 Sivir, Ambitious: the 'assigned 5 or more excess damage to enemy units' trigger condition " +
    "needs the combat-damage assignment statistic (467.2.c.4) — HistoryQuery only returns event counts and the " +
    "conquer payload declares no fields; the conquer timing point itself is emitted by turn/flow.ts"
);

// Direct evidence for the condition gap: the authored source-characteristic
// read is not satisfied by any merged evaluator, and the previous count spelling
// would have been silently satisfied by unrelated objects.
test("sfd-120-221 Sivir, Ambitious: the excess-damage condition fails closed on the merged evaluator", () => {
  const kernel = world().unit("dummy", { owner: "A", might: 7 }).build();
  const environment = {
    context: bindResolveContext(kernel, { source: kernel.getObject("dummy") }),
    host: kernel.ref("dummy"),
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false
  };
  assert.throws(
    () => evaluateCondition(conquerTrigger.trigger.condition, environment),
    (error) => {
      assert.match(error.message, /Unavailable characteristic: excessDamageAssignedThisCombat/);
      return true;
    }
  );
});

test("sfd-120-221 Sivir, Ambitious: an object count cannot stand in for the assigned damage (467.2.c.4)", () => {
  // Six unrelated objects on the Board satisfy a count-shaped condition, which
  // is exactly why the authored condition no longer uses count: the amount is
  // damage, not a number of objects.
  const kernel = world()
    .unit("u1", { owner: "A" })
    .unit("u2", { owner: "A" })
    .unit("u3", { owner: "A" })
    .unit("u4", { owner: "A" })
    .unit("u5", { owner: "A" })
    .unit("u6", { owner: "A" })
    .build();
  const environment = {
    context: bindResolveContext(kernel, { source: kernel.objects[0] }),
    host: kernel.objects[0].ref,
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false
  };
  const countSpelling = {
    kind: "compare",
    left: { kind: "count", subject: "excess-damage-assigned-this-combat", filter: { scope: "this-attack" } },
    operator: "gte",
    right: { kind: "constant", value: 5 }
  };
  assert.equal(evaluateCondition(countSpelling, environment), true);
  // The shipped condition never returns a value for these objects.
  assert.throws(() => evaluateCondition(conquerTrigger.trigger.condition, environment));
});

test("sfd-120-221 Sivir, Ambitious: the merged filter translator rejects the this-attack scope spelling", () => {
  assert.throws(
    () => translateObjectFilter({ targetController: "opponent", scope: "this-attack" }),
    (error) => {
      assert.match(error.message, /Unsupported filter field targetController/);
      return true;
    }
  );
});

test("sfd-120-221 Sivir, Ambitious: the real conquer payload still carries no host identity", () => {
  // turn/flow.ts emits the conquer timing point from the scoring step with only
  // player + details.battlefieldId; the registered object anchor therefore never
  // matches, which is why the trigger cannot fire end to end (383.4.c.2.a).
  const scoringPayload = { timingPoint: "conquer", player: "A", details: { battlefieldId: "battlefield-1" } };
  assert.equal(matchesTriggerEvent({ event: "conquered", object: { objectId: "sivir" } }, scoringPayload, "A"), false);
});

test("sfd-120-221 Sivir, Ambitious: the conquer alias and nested self anchor register in the real event pipeline", () => {
  // Test the binding surface only. The shipped program remains judge-gated;
  // its excess-damage read and the actual conquer host payload are unresolved.
  const { judgeReason, ...definition } = program;
  const binding = createProgramBinding({ cardPrograms: [{ ...definition, status: "executable" }] });
  const { engine, kernel } = fixture({ cards: [{ id: "sivir", cardId: CANONICAL, types: ["unit"], might: 7 }] });
  engine.commit({ type: "move-zone", object: kernel.ref("sivir"), to: "battlefield", location: { type: "battlefield", id: "battlefield-1" } });
  const source = kernel.getObject("sivir");
  const ids = binding.registerProgramTriggers(engine, source);
  assert.equal(ids.length, 1);
  const registration = engine.pipeline.checkpoint().triggers.get(ids[0]);
  assert.equal(registration.spec.at, "conquer");
  assert.deepEqual(registration.spec.filter, { event: "conquered", object: { objectId: "sivir" } });
  assert.deepEqual(registration.spec.condition, conquerTrigger.trigger.condition);
  assert.equal(validateTriggerSpec(registration.spec).ok, true);
  assert.deepEqual(registration.body, conquerTrigger.body);

  // The spelling fix does not supply the producer's missing host snapshot.
  // This is the payload shape emitted by turn/flow.ts, not a fabricated attack.
  const scoringPayload = { timingPoint: "conquer", player: "A", details: { battlefieldId: "battlefield-1" } };
  assert.equal(matchesTriggerEvent(registration.spec.filter, scoringPayload, "A"), false);
  assert.equal(engine.items.length, 0);
});

test("sfd-120-221 Sivir, Ambitious: the two-Power any-domain requirement accepts mixed domains", () => {
  const kernel = world().player("A", { energy: 0, power: ["Calm", "Chaos"] }).unit("sivir", { cardId: CANONICAL }).build();
  const plan = buildCostPlan(kernel, {
    id: "deflect-any-domain-requirement",
    cost: { payments: [{ kind: "power", amount: { kind: "constant", value: keyword.value }, allowedDomains: DUEL_DOMAINS }] }
  });
  assert.deepEqual(plan.total.power, [{ amount: 2, allowedDomains: DUEL_DOMAINS }]);
  assert.equal(plan.total.energy, 0);
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.power.power, [
    { requirementIndex: 0, from: "Calm", amount: 1 },
    { requirementIndex: 0, from: "Chaos", amount: 1 }
  ]);
  assert.deepEqual(receipt.actions.map(entry => entry.action), [{
    type: "pay", player: "A", plan: { finalized: true, energy: 0, power: ["Calm", "Chaos"] }
  }]);
  assert.deepEqual(kernel.events.map(event => event.action), ["pay"]);
});

test("sfd-120-221 Sivir, Ambitious: energy cannot substitute for the two-Power requirement", () => {
  const kernel = world().player("A", { energy: 10, power: ["Body"] }).unit("sivir", { cardId: CANONICAL }).build();
  const plan = buildCostPlan(kernel, {
    id: "deflect-insufficient-power",
    cost: { payments: [{ kind: "power", amount: { kind: "constant", value: keyword.value }, allowedDomains: DUEL_DOMAINS }] }
  });
  assert.throws(() => payCostPlan(kernel, plan), error => error.reason === "cannot-pay-cost");
  assert.equal(kernel.player("A").energy, 10);
  assert.deepEqual(kernel.events, []);
});

test.todo(
  "sfd-120-221 Sivir, Ambitious: [Deflect 2]'s expansion (effects/keywords/Deflect.ts target.tax) is consumed by " +
    "the target pipeline so opponents must pay :rb_rune_rainbow::rb_rune_rainbow: to choose Sivir " +
    "(809.1.c/809.1.c.1) — the chain must append the existing any-domain Power payment; it currently appends an Energy cost"
);

test.todo(
  "sfd-120-221 Sivir, Ambitious: \"that much\" resolves from the wired excess-damage total once the statistic " +
    "exists; the authored read is currently fail-closed (MissingInformation), so no damage is dealt and no fixed " +
    "amount is substituted"
);
