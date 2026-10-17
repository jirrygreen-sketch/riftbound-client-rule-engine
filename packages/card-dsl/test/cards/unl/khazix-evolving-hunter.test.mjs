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
  assert.match(program.judgeReason, /RIFT-120/);
  // Hunt's KeywordDef is merged (RIFT-265); the remaining Hunt gap is the
  // conquer/hold event spelling and payload, not a missing definition.
  assert.match(program.judgeReason, /RIFT-265/);
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

test("unl-119-219 Kha'Zix, Evolving Hunter: neither Hunt nor the attack trigger can register today", async () => {
  const { translateTriggerFilter } = await import("../../../../engine-core/dist/programs/filters.js");
  const { translateInstructionTargets } = await import("../../../../engine-core/dist/programs/filters.js");
  const { validateTriggerSpec } = await import("../../../../engine-core/dist/events/trigger-spec.js");
  // (a) Hunt authors the timing-point id as the event name; the closed
  // vocabulary spells the same event "conquered".
  const huntFilter = validateTriggerSpec({
    at: "conquer",
    filter: translateTriggerFilter({ event: "conquer", filter: { source: "self" } }, "khazix")
  });
  assert.equal(huntFilter.ok, false);
  assert.equal(huntFilter.issues[0].code, "invalid-event-type");

  // (b) attack-declared is a valid spelling, but the declared body carries the
  // 359.3.f "here" anchor (sameLocationAs) inside a TargetSpec, and the program
  // binding's instruction translator rejects that card-side anchor.
  assert.throws(
    () => translateInstructionTargets(attackTrigger.body),
    error => error.code === "judge-required" && /Unsupported filter field sameLocationAs/.test(error.message)
  );
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
  "unl-119-219 Kha'Zix, Evolving Hunter: [Hunt] expands to “When I Conquer or Hold, my controller gains 1 XP” " +
    "(CR 823.1.c.1/.c.2) once a Hunt KeywordDef and the conquer/hold emitters exist (RIFT-33/RIFT-120)"
);
test.todo(
  "unl-119-219 Kha'Zix, Evolving Hunter: “spend 3 XP” is charged at Finalize as an instruction cost " +
    "(CR 740.4.a / 740.4.a.2, 730.2) and the decline path is a real choice — no cost.xp primitive or cost-plan " +
    "wiring is merged (RIFT-9 directPrimitive for this card)"
);
test.todo(
  "unl-119-219 Kha'Zix, Evolving Hunter: the attack-declared timing point reaches this trigger from the combat " +
    "workflow (CR 383.4.e) — docs/rules/timing-point-producers.md lists it as 待后续 (RIFT-33/RIFT-120)"
);

