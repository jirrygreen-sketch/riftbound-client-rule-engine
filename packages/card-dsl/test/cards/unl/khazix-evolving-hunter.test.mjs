import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/khazix-evolving-hunter.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-3909cd8333cf6abffca3ccc632c393edd64ca5fb88d9da9db4f7b40d400e6778";
const SOURCE_TEXT =
  "[Hunt] (When I conquer or hold, gain 1 XP.)\n" +
  "When I attack, you may spend 3 XP to deal damage equal to my Might to an enemy unit here.";

const [hunt, attackTrigger] = program.abilities;
const [optional] = attackTrigger.body;
const [spendXp, dealDamage] = optional.args.body.value;
const [enemyUnitSpec] = dealDamage.targets;

test("unl-119-219 Kha'Zix, Evolving Hunter: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-119-219 Kha'Zix, Evolving Hunter: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /Hunt/);
  assert.match(program.judgeReason, /cost\.xp/);
  assert.match(program.judgeReason, /740\.4\.a/);
  assert.match(program.judgeReason, /attack-declared/);
  // Hunt's KeywordDef and expansion are present; the remaining Hunt gap is the
  // conquer/hold event spelling and payload, not a missing definition.
  assert.match(program.judgeReason, /KeywordDef 与展开已存在/);
  assert.match(program.judgeReason, /conquer 发射也不带征服单位/);
  // The target anchor's real rejection point and the host query limitation are
  // named instead of a stale card-dsl validation claim.
  assert.match(program.judgeReason, /Unsupported filter field sameLocationAs/);
  assert.match(program.judgeReason, /EngineRuntimeHost\.matchesFilter/);
  assert.equal(/待实现|需要裁定/.test(program.judgeReason), false);
});

test("unl-119-219 Kha'Zix, Evolving Hunter: [Hunt] omits the value, which is Hunt 1 (823.1.c.2)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(hunt, { kind: "keyword", keyword: "hunt" });
  assert.equal(hunt.value, undefined);
});

test("unl-119-219 Kha'Zix, Evolving Hunter: the merged Hunt definition expands to the 1 XP conquer/hold triggers", async () => {
  const { default: huntDefinition } = await import("../../../../engine-core/dist/effects/keywords/Hunt.js");
  const expansion = huntDefinition.expand({ host: { canonicalCardId: CANONICAL_ID } });
  // 823.1.c.1/.c.2: "When I conquer or hold, gain 1 XP" from the omitted value.
  assert.deepEqual(expansion.map(ability => ability.trigger.at), ["conquer", "hold"]);
  assert.deepEqual(expansion.map(ability => ability.body[0].args.amount), [
    { kind: "constant", value: 1 },
    { kind: "constant", value: 1 }
  ]);
});

test("unl-119-219 Kha'Zix, Evolving Hunter: the merged Hunt expansion is rejected by the closed event vocabulary", async () => {
  // 823.1.c.1: the definition emits conquering/holding triggers, but its
  // "conquer"/"hold" spellings are not in EVENT_PATTERN_TYPES (the closed
  // vocabulary uses conquered/held), so registration fails before any unit
  // payload question arises.
  const { default: huntDefinition } = await import("../../../../engine-core/dist/effects/keywords/Hunt.js");
  const { validateTriggerSpec } = await import("../../../../engine-core/dist/events/trigger-spec.js");
  const expansion = huntDefinition.expand({ host: { canonicalCardId: CANONICAL_ID } });
  for (const ability of expansion) {
    const validation = validateTriggerSpec({ at: ability.trigger.at, filter: ability.trigger.filter });
    assert.equal(validation.ok, false);
    assert.deepEqual(validation.issues.map(issue => issue.code), ["unknown-field"]);
  }
  // The closed spelling that does register maps to the same runtime timing point.
  const { matchesTriggerEvent } = await import("../../../../engine-core/dist/events/pipeline-match.js");
  const conquerEvent = { timingPoint: "conquer", kind: "conquer", player: "A" };
  assert.equal(matchesTriggerEvent({ event: "conquered", player: "self" }, conquerEvent, "A"), true);
});

test("unl-119-219 Kha'Zix, Evolving Hunter: the attack body's sameLocationAs anchor translates", async () => {
  // 359.3.f / contract 3.6: the printed "here" is expressed with
  // sameLocationAs:"source". programs/filters.ts translateObjectFilter rejects
  // the key, so registerProgramTriggers cannot install the attack ability; and
  // the PipelineHost query surface (both the reference kernel and the server
  // runtime host) does not resolve that anchor either.
  const { translateObjectFilter } = await import("../../../../engine-core/dist/programs/filters.js");
  const translated = translateObjectFilter(enemyUnitSpec.filter);
  assert.equal(translated.sameLocationAs, "source");

  const kernel = world()
    .unit("khazix", { owner: "A", controller: "A", might: 5, location: { type: "battlefield", id: "bf-1" } })
    .unit("here", { owner: "B", controller: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .build();
  // The reference host query ignores the relative anchor, so a far-away enemy
  // would be offered as an "here" candidate if the binding were bypassed.
  assert.deepEqual(kernel.query(enemyUnitSpec.filter), []);
  // Dropping only the unsupported anchor exposes the single enemy unit that the
  // production binding cannot express.
  assert.equal(kernel.query({ type: "unit", controller: "B" }).length, 1);
});

test("unl-119-219 Kha'Zix, Evolving Hunter: the declared 'here' anchor resolves against the source's location", async () => {
  // 359.3.f: "here" refers to the ability source's location. The interpreter's
  // selector layer resolves the retained sameLocationAs anchor against the
  // symbolic "source", so the declared filter has a real consumer.
  const { queryObjects } = await import("../../../../engine-core/dist/effects/interpreter/selectors.js");
  const { matchesObjectFilter } = await import("../../../../engine-core/dist/layers/filter.js");
  assert.deepEqual(enemyUnitSpec.filter, {
    type: "unit",
    controller: "opponent",
    sameLocationAs: "source"
  });

  const kernel = world()
    .unit("khazix", { owner: "A", controller: "A", might: 5, location: { type: "battlefield", id: "bf-1" } })
    .unit("here", { owner: "B", controller: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("far", { owner: "B", controller: "B", might: 3, location: { type: "battlefield", id: "bf-2" } })
    .build();
  const source = kernel.getObject("khazix");
  const scoped = kernel.clone({ sourceSnapshot: source, controller: "A" });
  const chainQuery = (filter) => {
    const normalized = { ...filter };
    if (normalized.controller === "opponent") normalized.controller = "any";
    return kernel.query({}).filter(object => matchesObjectFilter(normalized, object) &&
      !(filter.controller === "opponent" && object.controller === source.controller));
  };
  const matched = queryObjects(enemyUnitSpec.filter, {
    context: scoped,
    host: scoped.ref("khazix"),
    query: chainQuery,
    linked: () => undefined,
    canLookBack: () => false,
    isIgnored: () => false
  }).map(object => object.ref.id);
  assert.deepEqual(matched, ["here"]);
});

test("unl-119-219 Kha'Zix, Evolving Hunter: 'When I attack' is an attack-declared trigger on the source (383.4.e)", () => {
  assert.equal(attackTrigger.kind, "triggered");
  assert.equal(attackTrigger.trigger.at, "attack-declared");
  assert.deepEqual(attackTrigger.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self", player: "controller" }
  });
  assert.equal(attackTrigger.trigger.condition, undefined);
  assert.equal(attackTrigger.trigger.once, undefined);
  // 740.4.a.2: the cost inside the first part of a triggered ability is paid at
  // finalization, so the “may” gate belongs to the trigger resolution.
  assert.equal(attackTrigger.optional, true);
});

test("unl-119-219 Kha'Zix, Evolving Hunter: the printed 'you may …' wraps the chosen instructions in a body", () => {
  // Contract 3.9: “可以……” is written as choice.optional with the selected
  // instructions inside body, never as a choice plus linkedTo.
  assert.equal(attackTrigger.body.length, 1);
  assert.equal(optional.id, "khazix-evolving-hunter.may-spend-xp");
  assert.equal(optional.op, "choice.optional");
  assert.equal(optional.linkedTo, undefined);
  assert.equal(optional.condition, undefined);
  assert.deepEqual(optional.args.prompt, {
    kind: "constant",
    value: "Spend 3 XP to deal damage equal to my Might?"
  });
  assert.equal(optional.args.body.kind, "constant");
});

test("unl-119-219 Kha'Zix, Evolving Hunter: 'spend 3 XP to …' is recorded with the cost-within-instruction shape (740.4.a)", () => {
  assert.equal(spendXp.id, "khazix-evolving-hunter.spend-3-xp");
  // 730.2: spending XP reduces the marked value; it is a cost (cost.xp), not an
  // effect primitive, so the card must not restate it as an effect instruction.
  assert.equal(spendXp.op, "cost.xp");
  assert.deepEqual(spendXp.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(spendXp.args.player, { kind: "constant", value: "controller" });
  assert.deepEqual(spendXp.args.linkKey, { kind: "constant", value: "spentXp" });
  assert.equal(spendXp.targets, undefined);
  assert.equal(spendXp.picks, undefined);
  assert.equal(spendXp.linkedTo, undefined);
});

test("unl-119-219 Kha'Zix, Evolving Hunter: the damage clause is gated on the paid cost and reads the source's Might", () => {
  assert.equal(dealDamage.id, "khazix-evolving-hunter.deal-might-damage");
  assert.equal(dealDamage.op, "effect.damage");
  assert.equal(dealDamage.linkedTo, undefined);
  // 740.4.a: “[do X] to [do Y]” — the effect only happens when the cost was paid.
  assert.deepEqual(dealDamage.condition, {
    kind: "compare",
    left: {
      kind: "linked-value",
      instructionId: "khazix-evolving-hunter.spend-3-xp",
      key: "spentXp"
    },
    operator: "gte",
    right: { kind: "constant", value: 3 }
  });
  // 143.2 / contract 3.6: “equal to my Might” evaluates at resolution time.
  assert.deepEqual(dealDamage.args.amount, {
    kind: "object-property",
    object: "source",
    property: "might"
  });
  assert.deepEqual(dealDamage.args.target, {
    kind: "constant",
    value: "khazix-evolving-hunter.enemy-unit-here"
  });
  // 418.6.a: the unspecified source of the Deal action is the effect itself.
  assert.equal(dealDamage.args.source, undefined);

  // 355.7/355.9.a plus the 359.3.f “here” referent: an opponent's unit at the
  // source's location, chosen as a target.
  assert.deepEqual(enemyUnitSpec, {
    id: "khazix-evolving-hunter.enemy-unit-here",
    filter: { type: "unit", controller: "opponent", sameLocationAs: "source" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("unl-119-219 Kha'Zix, Evolving Hunter golden: the damage equals the source's current Might (143.2)", () => {
  const base = world()
    .unit("khazix", { owner: "A", might: 5, location: { type: "battlefield", id: "bf-1" } })
    .unit("here", { owner: "B", controller: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("far", { owner: "B", controller: "B", might: 3, location: { type: "battlefield", id: "bf-2" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("khazix") });

  const run = runInstruction(
    damage,
    {
      // The production path supplies the "source" selector; the reference kernel
      // is fed the same expression shape with a live reference, as sibling
      // goldens do.
      amount: { kind: "object-property", object: kernel.ref("khazix"), property: "might" },
      target: "khazix-evolving-hunter.enemy-unit-here"
    },
    { world: kernel, targets: { "khazix-evolving-hunter.enemy-unit-here": [kernel.ref("here")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("here").damage, 5);
  assert.equal(kernel.getObject("far").damage, 0);
  assert.equal(run.linked.dealt, 5);
  assert.deepEqual(run.events.map(event => event.action), ["damage"]);
});

test("unl-119-219 Kha'Zix, Evolving Hunter golden: a Might of 0 deals no damage and is negated (418.1.e.1)", () => {
  const base = world()
    .unit("khazix", { owner: "A", might: 0, location: { type: "battlefield", id: "bf-1" } })
    .unit("here", { owner: "B", controller: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("khazix") });

  const run = runInstruction(
    damage,
    {
      amount: { kind: "object-property", object: kernel.ref("khazix"), property: "might" },
      target: "khazix-evolving-hunter.enemy-unit-here"
    },
    { world: kernel, targets: { "khazix-evolving-hunter.enemy-unit-here": [kernel.ref("here")] } }
  );

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(kernel.getObject("here").damage, 0);
  assert.deepEqual(run.events, []);
});

test.todo(
  "unl-119-219 Kha'Zix, Evolving Hunter: [Hunt] reaches the real conquered/held event producers with the " +
    "conquering unit in the payload (CR 823.1.c.1/.c.2)"
);
test.todo(
  "unl-119-219 Kha'Zix, Evolving Hunter: charge the optional 3 XP instruction cost at Finalize, and declining " +
    "it pays nothing and deals no damage (CR 740.4.a/740.4.a.2 / 730.2; instruction-cost receipt adapter)"
);
test.todo(
  "unl-119-219 Kha'Zix, Evolving Hunter: the attack-declared timing point reaches this trigger from the combat " +
    "workflow (CR 383.4.e), including the attack role designation and trigger registration"
);
