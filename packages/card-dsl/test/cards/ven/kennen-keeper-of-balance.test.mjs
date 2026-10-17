import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/kennen-keeper-of-balance.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { DUEL_DOMAINS } from "../../../../engine-core/dist/cost/resources.js";
import { buildHiddenCostPlan, payHiddenCostPlan } from "../../../../engine-core/dist/cost/kinds/hidden.js";
import { createEngineStaticBinder, createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

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
    .player("controller", { energy: 2 })
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
  // The reason keeps naming the merged cost.pay / [Hidden] material (now as the
  // already-supported half) while replacing the stale merged-task citations
  // (RIFT-257/261/87) with the four real, still-open gaps.
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /Hidden/);
  assert.match(program.judgeReason, /buildHiddenCostPlan/);
  assert.match(program.judgeReason, /Facedown Zone/);
  assert.match(program.judgeReason, /740\.4\.a\.2/);
  assert.match(program.judgeReason, /assertFinalizationSurface/);
  assert.match(program.judgeReason, /matchesObjectFilter/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /LITERAL_FIELDS/);
  assert.doesNotMatch(program.judgeReason, /noopStaticBinder/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(?:87|257|261)\b/);
});

test("ven-135-166 Kennen: the merged keyword binding expands [Hidden] through its KeywordDef", () => {
  // The merged Hidden KeywordDef is resolved through the generated registry by
  // the merged expandProgram, so the declaration really produces the expansion;
  // what the expansion still lacks is the Hide/Facedown runtime (judgeReason).
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
    assert.deepEqual(pay.args.payments, { kind: "constant", value: { energy: 2 } }, label);
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
  // “a stunned enemy unit here”: opponent-controlled (740.1.b), same battlefield
  // (053.3 here), Stunned (424.1.a). The Stunned predicate uses the merged
  // "states" spelling because a bare stunned:true key is a matcher no-op.
  assert.deepEqual(mightAura.condition.left.filter, {
    type: "unit",
    zone: "board",
    controller: "opponent",
    states: "stunned",
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

  // 接受整条可选 body 时，已合入的 cost.pay 真实支付 2 Energy 后再结算 Stun。
  const accepted = kennenKernel();
  accepted.setAnswers({ "kennen.play.opt-in/optional": true });
  accepted.setTargets("kennen.play.unit", [accepted.ref("enemy")]);
  const acceptedOutcome = runAbilityBody(playAbility.body, accepted);
  assert.equal(acceptedOutcome.status, "executed");
  assert.equal(accepted.getObject("enemy").stunned, true);
  assert.equal(accepted.player("controller").energy, 0);
});

test("ven-135-166 golden: the +2 Might aura's declared modification executes through the merged primitive (CR 433.1.a)", () => {
  // The card's static ability names the merged continuous.might shape: the same
  // declared amount (2) registers an arithmetic-layer modification through the
  // real primitive. The remaining gap is the printed condition on the layer
  // query path (see the binder test below and judgeReason), not this shape.
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
});

test("ven-135-166 Kennen: [Hidden] expands to cost.hidden and the merged cost layer really settles 811.1.b", () => {
  // The merged Hidden KeywordDef expands to a static cost.hidden effect, and the
  // merged cost layer can really settle 811.1.b's two modes: hiding costs the
  // [A] any-domain Power, playing from Hidden ignores base Energy/Power. What is
  // still missing is the Hide action, the Facedown Zone, and 811.6 (judgeReason).
  const hidden = keywordDefinitionsById.get("Hidden");
  assert.equal(hidden.stacking, "single");
  const [expansion] = hidden.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "cost.hidden");

  // The expansion itself is fail-closed in the production binder: the default
  // createEngineStaticBinder has no layer mapping for cost.hidden, so the
  // keyword cannot silently degrade into a no-op layer effect.
  const binderFixture = fixture({ cards: [{ id: "kennen", types: ["unit"], might: 2 }] });
  const bindError = (() => {
    try {
      createEngineStaticBinder(binderFixture.engine).bindStatic(expansion, binderFixture.kernel.getObject("kennen"));
      return null;
    } catch (error) {
      return error;
    }
  })();
  assert.equal(bindError?.name, "ProgramBindingError");
  assert.equal(bindError.code, "judge-required");
  assert.match(bindError.message, /Static ability kind cost\.hidden has no layer mapping/);
  assert.deepEqual(binderFixture.engine.layers.registry.list(), []);

  const hideBase = world()
    .player("A", { power: ["Order"] })
    .hand("kennen", { types: ["unit"], energy: 3, power: [] })
    .build();
  const hideKernel = hideBase.clone({ controller: "A", sourceSnapshot: hideBase.getObject("kennen") });
  const hide = buildHiddenCostPlan(hideKernel, { id: "hide:kennen", mode: "hide" });
  assert.equal(hide.total.energy, 0);
  assert.deepEqual(hide.total.power, [{ amount: 1, allowedDomains: DUEL_DOMAINS }]);
  const hideReceipt = payHiddenCostPlan(hideKernel, hide);
  assert.equal(hideReceipt.actions[0].action.type, "pay");
  assert.deepEqual(hideReceipt.actions[0].action.plan.power, ["Order"]);

  // 811.1.b: playing from Hidden keeps its [0] Energy base and ignores the
  // printed 3 Energy; later fees are retained (none printed here).
  const playBase = world()
    .player("A", { power: ["Order"] })
    .hand("kennen", { types: ["unit"], energy: 3, power: [] })
    .build();
  const playKernel = playBase.clone({ controller: "A", sourceSnapshot: playBase.getObject("kennen") });
  const play = buildHiddenCostPlan(playKernel, { id: "play:kennen", mode: "play" });
  assert.equal(play.base.energy, 3);
  assert.equal(play.total.energy, 0);
  assert.deepEqual(play.total.power, []);
});

test("ven-135-166 Kennen: the merged layer binder registers the aura but the layer query ignores its gates", () => {
  // programs/statics.ts's createEngineStaticBinder is attachProgramLifecycle's
  // default binder, so the card's static ability really registers an
  // arithmetic-layer modification. What fails is the printed condition: the
  // layer query path (layers/filter.ts) compares controller literally and never
  // reads sameLocationAs, so controller:"opponent" never matches and the aura is
  // fail-closed. The counterfactual control below shows why the controller gate
  // cannot simply be dropped: without it the same registration also fires for a
  // Stunned friendly unit and for a Stunned unit on another battlefield.
  const withFilter = (filter) => ({
    ...mightAura,
    condition: {
      kind: "compare",
      left: { kind: "count", subject: "stunned-enemy-units-here", filter },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  });
  const runAura = (ability) => {
    const f = fixture({
      cards: [
        { id: "kennen", types: ["unit"], might: 2 },
        { id: "nearFoe", types: ["unit"], might: 2, owner: "B", controller: "B" },
        { id: "farFoe", types: ["unit"], might: 2, owner: "B", controller: "B" },
        { id: "nearAlly", types: ["unit"], might: 2, owner: "A", controller: "A" }
      ]
    });
    const board = (id, location = { type: "battlefield", id: "battlefield-1" }) =>
      f.engine.commit({ type: "move-zone", object: f.kernel.ref(id), to: "battlefield", location });
    board("kennen");
    board("nearFoe");
    board("farFoe", { type: "battlefield", id: "bf-2" });
    board("nearAlly");
    f.engine.layers.setObjects(f.kernel.objects);
    createEngineStaticBinder(f.engine).bindStatic(ability, f.kernel.getObject("kennen"));
    f.engine.layers.setObjects(f.kernel.objects);
    const might = () => f.engine.layers.snapshot(f.kernel.ref("kennen")).might;
    const readings = { base: might() };
    for (const id of ["nearFoe", "farFoe", "nearAlly"]) {
      f.engine.commit({ type: "stun", object: f.kernel.ref(id) });
      f.engine.layers.setObjects(f.kernel.objects);
      readings[id] = might();
    }
    return { registered: f.engine.layers.registry.list(), readings };
  };

  const declared = runAura(mightAura);
  // The registration itself is real: one arithmetic-layer spec for this source.
  assert.equal(declared.registered.length, 1);
  assert.equal(declared.registered[0].effect.layer, "arithmetic");
  assert.equal(declared.registered[0].effect.effect.kind, "continuous.might");
  assert.equal(declared.registered[0].effect.effect.amount, 2);
  // Fail-closed on the printed gates: even a Stunned enemy unit at the same
  // battlefield does not raise the Might here.
  assert.deepEqual(declared.readings, { base: 2, nearFoe: 2, farFoe: 2, nearAlly: 2 });

  // Counterfactual control (deliberately NOT the card's IR): dropping the
  // controller gate lets the same registration fire for a friendly unit here
  // and for a unit on another battlefield, so the printed gates cannot be
  // dropped or folded into this shape.
  const counterfactual = runAura(withFilter({
    type: "unit",
    zone: "board",
    states: "stunned",
    sameLocationAs: "self"
  }));
  assert.deepEqual(counterfactual.readings, { base: 2, nearFoe: 4, farFoe: 4, nearAlly: 4 });
});

test("ven-135-166 Kennen golden: the printed condition discriminates through the merged query path (053.3 / 424.1.a / 740.1.b)", () => {
  // The condition itself is expressible and executable through the merged
  // interpreter query path (interpreter/selectors.ts honors sameLocationAs)
  // together with chain/engine.ts's controller/owner normalization.
  const predicate = {
    id: "kennen.aura.condition",
    op: "condition.predicate",
    args: { condition: { kind: "constant", value: mightAura.condition } }
  };
  const chainQuery = (kernel) => (filter) => {
    const normalized = { ...filter };
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "self") normalized[key] = kernel.controller;
      if (normalized[key] === "opponent") normalized[key] = "any";
    }
    return kernel.objects.filter((object) => {
      for (const key of ["controller", "owner"]) {
        if (normalized[key] === "any" && object[key] === kernel.controller) return false;
      }
      return matchesObjectFilter(normalized, object);
    });
  };
  const valueFor = ({ foeStunned = true, foeLocation, allyStunned = false } = {}) => {
    const base = world()
      .unit("kennen", { controller: "A", might: 2, location: { type: "battlefield", id: "bf-1" } })
      .unit("foe", {
        owner: "B",
        controller: "B",
        stunned: foeStunned,
        location: foeLocation ?? { type: "battlefield", id: "bf-1" }
      })
      .unit("ally", { owner: "A", controller: "A", stunned: allyStunned, location: { type: "battlefield", id: "bf-1" } })
      .build();
    const kernel = base.clone({ controller: "A", sourceSnapshot: base.getObject("kennen") });
    const context = bindResolveContext(kernel, { query: chainQuery(kernel) });
    return runAbilityBody([predicate], context, undefined, { host: kernel.ref("kennen") })
      .linkedValues["kennen.aura.condition.value"];
  };

  assert.equal(valueFor({}), true, "a Stunned enemy unit here satisfies the condition");
  assert.equal(valueFor({ foeStunned: false }), false, "a ready enemy unit here does not");
  assert.equal(
    valueFor({ foeLocation: { type: "battlefield", id: "bf-2" } }),
    false,
    "a Stunned enemy unit on another battlefield does not (053.3 here)"
  );
  assert.equal(
    valueFor({ foeStunned: false, allyStunned: true }),
    false,
    "a Stunned friendly unit here does not (740.1.b)"
  );
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

test("ven-135-166 Kennen golden: the production chain gate blocks the optional trigger before resolution (finalize)", () => {
  // 740.4.a.2 wants the "you may pay :rb_energy_2:" cost paid at Finalize, but
  // the frozen TriggeredAbility carries no cost field and programs/triggers.ts
  // never extracts an instruction cost into TriggerRegistration.cost /
  // mayAtFinalize. On top of that the TargetSpecs live inside the
  // choice.optional body, which chain/engine.ts's assertFinalizationSurface
  // refuses. Drive the real ChainEngine + ProgramBinding to show the refusal.
  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const f = fixture({
    cards: [
      { id: "kennen", cardId: CANONICAL_ID, types: ["unit"], energy: 3, power: [], might: 2 },
      { id: "foe", types: ["unit"], energy: 3, power: [], might: 2, owner: "B", controller: "B" }
    ],
    describePlay: binding.describePlay,
    // The pipeline asks whether to take the optional triggered ability; answer
    // yes so the trigger really becomes a Pending item before Finalize runs.
    choose: (request) => (request.type === "optional" ? true : undefined)
  });
  binding.attachLifecycle(f.engine);
  const board = (id) => f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref(id),
    to: "battlefield",
    location: { type: "battlefield", id: "battlefield-1" }
  });
  board("kennen");
  board("foe");
  // The "When I attack" trigger really reaches the pipeline as a Pending item.
  f.engine.pipeline.emit({
    timingPoint: "attack-declared",
    object: f.kernel.getObject("kennen"),
    source: f.kernel.getObject("kennen"),
    player: "A"
  });
  const pending = f.engine.items.filter((item) => item.kind === "triggered");
  assert.equal(pending.length, 1, "the attack trigger is appended as a Pending item");
  // ...and Finalize refuses to lock the trigger's nested target, so the paid
  // Stun can never resolve from the production chain.
  assert.throws(
    () => f.engine.advance(),
    /Nested\/repeated targets require an interpreter target-selection lifecycle adapter/
  );
  assert.equal(f.kernel.getObject("foe").stunned, false);
});

test("ven-135-166 Kennen: the production chain body adapter cannot execute the declared Stun instruction", () => {
  // The interpretation half runs the program's own instruction through
  // chain/interpreter-adapter.ts, whose LITERAL_FIELDS table does not unwrap
  // effect.stun.target; the primitive therefore rejects the Expr-wrapped spec
  // id. Executing the same instruction with the literal spec id works, so the
  // gap is the adapter table, not the primitive or the declared IR.
  const { targets, linkedTo, ...declared } = playChoice.args.body.value[1];
  const kernel = kennenKernel();
  kernel.setTargets("kennen.play.unit", [kernel.ref("enemy")]);
  const before = { stunned: kernel.getObject("enemy").stunned, events: kernel.events.length };
  assert.throws(
    () => resolveChainBody([declared], kernel),
    /effect\.stun target must be a spec id string/
  );
  // The rejection happens before any state change, so the reference kernel is
  // untouched by the failed run.
  assert.equal(kernel.getObject("enemy").stunned, before.stunned);
  assert.equal(kernel.events.length, before.events);

  const literal = { ...declared, args: { ...declared.args, target: "kennen.play.unit" } };
  const literalKernel = kennenKernel();
  literalKernel.setTargets("kennen.play.unit", [literalKernel.ref("enemy")]);
  const outcome = resolveChainBody([literal], literalKernel);
  assert.equal(outcome.status, "executed");
  assert.equal(literalKernel.getObject("enemy").stunned, true);
  assert.deepEqual(outcome.events.map((event) => event.action), ["stun"]);
});
