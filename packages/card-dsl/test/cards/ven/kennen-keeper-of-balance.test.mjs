import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/kennen-keeper-of-balance.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL_ID =
  "card.hash-6d5c7c18a2ff9af74ab3f4a4b8ac837540733c2922614f53be32ab4e75be8f6b";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "When you play me or I attack, you may pay :rb_energy_2: to [Stun] a unit. " +
  "(It doesn't deal combat damage this turn.)\n" +
  "While there's a stunned enemy unit here, I have +2 :rb_might:.";

const [hidden, playAbility, attackAbility, mightAura] = program.abilities;
const playChoice = playAbility.body[0];
const attackChoice = attackAbility.body[0];

const kennenKernel = () => {
  const base = world()
    .player("controller")
    .unit("kennen", { controller: "controller", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  return base.clone({ controller: "controller", sourceSnapshot: base.getObject("kennen") });
};

test("ven-135-166 Kennen, Keeper of Balance: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("ven-135-166 Kennen: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /Hidden/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /noopStaticBinder|RIFT-257/);
});

test("ven-135-166 Kennen: the merged keyword binding expands [Hidden] through its KeywordDef", () => {
  // RIFT-264 merged Hidden's KeywordDef; RIFT-257's expandProgram resolves the
  // card's keyword ability through the generated registry, so the declaration
  // really produces the expansion (whose consumer is still missing - see todo).
  assert.ok(keywordDefinitionsById.get("Hidden"));
  const kernel = world()
    .unit("kennen", { zone: "board", keywords: [{ id: "hidden" }] })
    .build();
  const registry = new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]);
  const expanded = expandProgram(registry.get(CANONICAL_ID), kernel.getObject("kennen"));
  assert.deepEqual(
    expanded.expanded.filter(ability => ability.kind === "static").map(ability => ability.effect.kind),
    ["cost.hidden"]
  );
});

test("ven-135-166 Kennen: [Hidden] declared, play and attack triggers both optional", () => {
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });

  assert.equal(playAbility.kind, "triggered");
  assert.equal(playAbility.trigger.at, "card-played");
  assert.deepEqual(playAbility.trigger.filter, { self: true });
  assert.equal(playAbility.optional, true);

  // 383.4.e / 466.2.c: “I attack” is an attack trigger filtered to the source.
  assert.equal(attackAbility.kind, "triggered");
  assert.equal(attackAbility.trigger.at, "attack-declared");
  assert.deepEqual(attackAbility.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(attackAbility.optional, true);
});

test("ven-135-166 Kennen: both triggers wrap pay-then-Stun in an optional body (contract 3.9)", () => {
  for (const [label, choice, ids] of [
    ["play", playChoice, ["kennen.play.pay", "kennen.play.stun"]],
    ["attack", attackChoice, ["kennen.attack.pay", "kennen.attack.stun"]]
  ]) {
    assert.equal(choice.op, "choice.optional", label);
    assert.equal(choice.args.body.kind, "constant", label);
    assert.deepEqual(
      choice.args.body.value.map(instruction => instruction.id),
      ids,
      label
    );
    const [pay, stun] = choice.args.body.value;
    // “you may pay :rb_energy_2:” — the 2 Energy payment (355.10.c.1 cost).
    assert.equal(pay.op, "cost.pay", label);
    assert.deepEqual(pay.args.energy, { kind: "constant", value: 2 }, label);
    assert.equal(pay.linkedTo, undefined, label);
    // “to [Stun] a unit” — one unit, stun through the merged primitive.
    assert.equal(stun.op, "effect.stun", label);
    assert.equal(stun.linkedTo, pay.id, label);
    assert.deepEqual(stun.args.target, { kind: "constant", value: stun.targets[0].id }, label);
    assert.equal(stun.targets.length, 1, label);
    assert.deepEqual(stun.targets[0].filter, { type: "unit", zone: "board" }, label);
    assert.equal(stun.targets[0].min, 1, label);
    assert.equal(stun.targets[0].max, 1, label);
    assert.equal(stun.targets[0].selection, "one", label);
  }
  // Independent statements: the play and attack bodies never link to each other.
  assert.deepEqual(playAbility.trigger.at, "card-played");
  assert.deepEqual(attackAbility.trigger.at, "attack-declared");
});

test("ven-135-166 Kennen: the statically-gated +2 Might aura shape", () => {
  assert.equal(mightAura.kind, "static");
  assert.equal(mightAura.effect.kind, "continuous.might");
  assert.equal(mightAura.effect.layer, "arithmetic");
  assert.deepEqual(mightAura.effect.amount, { kind: "constant", value: 2 });
  assert.equal(mightAura.effect.appliesTo, "self");
  assert.equal(mightAura.condition.kind, "compare");
  assert.equal(mightAura.condition.operator, "gte");
  assert.equal(mightAura.condition.left.kind, "count");
  // “a stunned enemy unit here”: opponent-controlled, same battlefield, Stunned.
  assert.deepEqual(mightAura.condition.left.filter, {
    type: "unit",
    zone: "board",
    controller: "opponent",
    stunned: true,
    sameLocationAs: "self"
  });
  assert.deepEqual(mightAura.condition.right, { kind: "constant", value: 1 });
});

test("ven-135-166 golden: declining the play trigger does nothing (no payment, no stun)", () => {
  const kernel = kennenKernel();
  kernel.setAnswers({ "kennen.play.opt-in/optional": false });
  const outcome = runAbilityBody(playAbility.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]), [
    ["kennen.play.opt-in", "negated", "skipped"]
  ]);
  assert.equal(kernel.getObject("enemy").stunned, false);
  assert.deepEqual(kernel.events, []);
});

test("ven-135-166 golden: the merged Stun half stuns the unit", () => {
  // The program's own stun instruction, with its TargetSpec locked by the
  // reference kernel exactly like Finalize would.
  const { targets, linkedTo, ...stunInstruction } = playChoice.args.body.value[1];
  const kernel = kennenKernel();
  kernel.setTargets("kennen.play.unit", [kernel.ref("enemy")]);

  const outcome = runAbilityBody([stunInstruction], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("enemy").stunned, true);
  assert.deepEqual(outcome.events.map(event => event.action), ["stun"]);
  assert.equal(outcome.linkedValues["kennen.play.stun.stunned"].count, 1);

});

test("ven-135-166 golden: the +2 Might aura's declared modification executes once registered (CR 433.1.a)", () => {
  // The card's static ability names the merged continuous.might shape: the same
  // declared amount (2) registers an arithmetic-layer modification through the
  // real primitive. What is missing is the card-side registration of the static
  // ability plus the "stunned enemy unit here" predicate (see judgeReason), so the
  // test drives the declared data through the interpreter and the layer engine.
  const base = world()
    .unit("kennen", { controller: "A", zone: "board", might: 2 })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("kennen") });
  const instruction = {
    id: "kennen.aura",
    op: "continuous.might",
    args: {
      amount: mightAura.effect.amount,
      // The static ability records mode/appliesTo as plain values; the
      // instruction form wraps them as constant expressions (contract 3.2).
      mode: { kind: "constant", value: mightAura.effect.mode },
      appliesTo: { kind: "constant", value: mightAura.effect.appliesTo }
    }
  };
  const outcome = runAbilityBody([instruction], kernel, undefined, { host: kernel.ref("kennen") });
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.equal(kernel.continuousEffects[0].effect.layer, "arithmetic");
  assert.equal(kernel.continuousEffects[0].effect.effect.kind, "continuous.might");
  assert.equal(kernel.continuousEffects[0].effect.effect.amount, 2);
  assert.equal(
    createLayerEngine(kernel.objects, kernel.continuousEffects).evaluate(kernel.ref("kennen")).might,
    4
  );

  // The evaluator never sees the condition: layers' conditionMatches only knows
  // always/never/type/has-tag/has-keyword and defaults to true, so the printed
  // "while there's a stunned enemy unit here" gate cannot be honoured today.
  assert.equal(mightAura.condition.kind, "compare");
  assert.equal(
    createLayerEngine([base.getObject("kennen")], [{
      effect: {
        id: "kennen.aura.ungated",
        layer: "arithmetic",
        source: base.ref("kennen"),
        filter: { objectId: "kennen" },
        effect: { ...mightAura.effect, condition: mightAura.condition }
      },
      duration: { type: "permanent" }
    }]).evaluate(base.ref("kennen")).might,
    // A no-enemy board still gets the +2: the gate is ignored.
    4
  );
});

test("ven-135-166 Kennen: the Hidden expansion names cost.hidden, which has no consumer", () => {
  // Merged Hidden KeywordDef (RIFT-264) expands to a static cost.hidden effect.
  // Hidden.ts records that the Hide action, the face-down play permission and
  // the continuous.timing grant are RIFT-261/257 work; this asserts the shape the
  // merged expansion hands to a consumer that does not exist yet.
  const hidden = keywordDefinitionsById.get("Hidden");
  assert.equal(hidden.stacking, "single");
  const [expansion] = hidden.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "cost.hidden");
});

test("ven-135-166 golden: an already stunned unit is not stunned twice (CR 424.1.a.1)", () => {
  const base = world()
    .player("controller")
    .unit("kennen", { controller: "controller" })
    .unit("enemy", { owner: "B", controller: "B", stunned: true })
    .build();
  const kernel = base.clone({ controller: "controller", sourceSnapshot: base.getObject("kennen") });
  kernel.setTargets("kennen.attack.unit", [kernel.ref("enemy")]);
  const { targets, linkedTo, ...stunInstruction } = attackChoice.args.body.value[1];
  const outcome = runAbilityBody([stunInstruction], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.stunned.count, 0);
  assert.equal(outcome.results[0].result.linkedValues.stunned.alreadyStunned, 1);
  assert.deepEqual(outcome.events, []);
});

test.todo(
  "ven-135-166 Kennen: paying :rb_energy_2: through the optional trigger needs the cost.pay " +
    "primitive and the finalized cost plan (RIFT-261)"
);

test.todo(
  "ven-135-166 Kennen: [Hidden]'s cost.hidden / facedown play permission has no consumer even " +
    "though the KeywordDef is merged (811.1.d; RIFT-261 / RIFT-257)"
);

test.todo(
  "ven-135-166 Kennen: the +2 Might aura needs the card-side continuous.might registration " +
    "(RIFT-257 static binder) and a Stunned-state predicate over the current battlefield (RIFT-87)"
);
