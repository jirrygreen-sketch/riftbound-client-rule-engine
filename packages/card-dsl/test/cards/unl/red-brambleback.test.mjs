import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/red-brambleback.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { assertTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { createEngineStaticBinder, translateCost } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { getTimingPoint } from "../../../../engine-core/dist/events/timing-points.js";

const CANONICAL_ID =
  "card.hash-cc540d8a2bbd62d237f265dc99b08da25c4499af36778a1dc01cf4165c0b9553";
const SOURCE_TEXT =
  "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
  "Your conquer effects for conquering here trigger an additional time.\n" +
  "When I conquer, [Buff] a friendly unit. (Give it a +1 :rb_might: buff if it doesn't have one.)";

const [accelerate, multiplicity, conquerTrigger] = program.abilities;
const [buffInstruction] = conquerTrigger.body;
const targetSpec = buffInstruction.targets[0];

// Finalize locks the Buff target; the reference kernel compares filter values
// literally, so the golden supplies the finalized target and drops only the
// TargetSpec, keeping the card's own instruction and arguments.
const stripTargets = ({ targets, ...instruction }) => instruction;
const BUFF_BODY = conquerTrigger.body.map(stripTargets);

function fixtureWith(options = {}) {
  const base = world()
    .unit("brambleback", { might: 4 })
    .unit("ally", { might: 2, owner: "A", buffs: options.allyBuffs })
    .build();
  return base.clone({ sourceSnapshot: base.getObject("brambleback") });
}

const executableProgram = () => ({ ...program, status: "executable", judgeReason: undefined });
const unitSnapshot = (overrides = {}) => ({
  ref: { id: "brambleback", zoneEntryId: 1 }, cardId: CANONICAL_ID, name: "Red Brambleback",
  types: ["unit"], tags: [], keywords: [{ id: "Accelerate" }],
  owner: "A", controller: "A", zone: "board", location: { type: "battlefield", id: "bf-1" },
  might: 4, energy: 4, power: ["Fury"], exhausted: false, damage: 0, stunned: false, buffs: 0,
  attachedTo: null, faceDown: false, isToken: false, combatRole: null,
  ...overrides
});

test("unl-029-219 Red Brambleback: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-029-219 Red Brambleback: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /conquer effects/);
  assert.match(program.judgeReason, /383\.4\.g\.2/);
  assert.match(program.judgeReason, /Accelerate/);
  // The stale "no trigger registration path" gap is gone (RIFT-257) and the
  // conquer timing point is really emitted; the reason must name the real gaps.
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /turn\/flow\.ts/);
  assert.match(program.judgeReason, /additional-cost/);
  // The freshly verified gap: the scoring wave carries no conquering-unit attribution.
  assert.match(program.judgeReason, /payloadFields/);
  assert.match(program.judgeReason, /sigil-of-the-storm/);
  assert.match(program.judgeReason, /没有声明 payloadFields/);
  assert.match(program.judgeReason, /conquered/);
  assert.match(program.judgeReason, /accelerate\.cost/);
  assert.doesNotMatch(program.judgeReason, /validateTriggerSpec/);
  assert.doesNotMatch(program.judgeReason, /RIFT-120/);
});

test("unl-029-219 Red Brambleback: [Accelerate] is a bare keyword declaration", () => {
  assert.equal(program.abilities.length, 3);
  // 805.1.b / 805.4: the fixed [1][power] cost and the redundancy rule live in
  // the keyword definition, so the card carries no value.
  assert.deepEqual(accelerate, { kind: "keyword", keyword: "accelerate" });
  assert.equal(accelerate.value, undefined);
});

test("unl-029-219 Red Brambleback: the extra-trigger clause is a trigger-collection rewrite, not a repeat", () => {
  // 383.4.c.3 / 383.4.g.2 (which uses this very card as its example): the named
  // Conquer Effects of units here trigger one extra time for a real Conquer.
  // The six Ability shapes have no trigger multiplicity and ContinuousEffect
  // has no consumer for it, so the clause stays a documented declaration (same
  // precedent as ogn/karthus-eternal and rad/detonation-amplifier).
  assert.equal(multiplicity.kind, "static");
  assert.equal(multiplicity.effect.kind, "continuous.trigger-multiplicity");
  assert.equal(multiplicity.effect.mode, "additional");
  assert.deepEqual(multiplicity.effect.amount, { kind: "constant", value: 1 });
  assert.deepEqual(multiplicity.effect.appliesTo, {
    trigger: "conquer",
    controller: "controller",
    zone: "board",
    here: true,
    realConquerOnly: true
  });
  assert.equal(multiplicity.condition, undefined);
  // The declaration stays a trigger-collection rewrite; the repeat.cost shape
  // (820's Repeat is an Optional Additional Cost keyword, exercised at
  // resolution) is deliberately not used here.
});

test("unl-029-219 Red Brambleback: the closed conquered event spelling passes registration validation", () => {
  const translated = translateTriggerFilter(
    conquerTrigger.trigger.filter,
    "brambleback",
    conquerTrigger.trigger.at
  );
  assert.deepEqual(translated, {
    event: "conquered",
    object: { objectId: "brambleback" }
  });
  assert.doesNotThrow(() => assertTriggerSpec({
    at: conquerTrigger.trigger.at,
    filter: translated
  }));
});

test("unl-029-219 Red Brambleback: the conquer trigger Buffs one chosen friendly unit", () => {
  // 383.4.c.2: "When I conquer" is this unit's Conquer Effect.
  assert.equal(conquerTrigger.kind, "triggered");
  assert.equal(conquerTrigger.trigger.at, "conquer");
  assert.deepEqual(conquerTrigger.trigger.filter, {
    event: "conquered",
    filter: { source: "self" }
  });
  assert.equal(conquerTrigger.optional, false);
  assert.equal(conquerTrigger.body.length, 1);

  assert.equal(buffInstruction.id, "red-brambleback.buff-friendly-unit");
  assert.equal(buffInstruction.op, "effect.buff");
  assert.deepEqual(buffInstruction.args.mode, { kind: "constant", value: "buff" });
  assert.deepEqual(buffInstruction.args.target, {
    kind: "constant",
    value: "red-brambleback.friendly-unit"
  });
  // 355.9 / 355.10: "a friendly unit" is a single chosen Board unit controlled
  // by the ability's controller; 702.2.a's Buff action places one counter.
  assert.deepEqual(targetSpec, {
    id: "red-brambleback.friendly-unit",
    filter: { type: "unit", controller: "controller", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(buffInstruction.picks, undefined);
  assert.equal(buffInstruction.linkedTo, undefined);
});

test("unl-029-219 Red Brambleback golden: the Buff action places one counter (CR 702.2.a)", () => {
  const kernel = fixtureWith({ allyBuffs: 0 });
  kernel.setTargets(targetSpec.id, [kernel.ref("ally")]);
  const outcome = resolveChainBody(BUFF_BODY, kernel);

  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["red-brambleback.buff-friendly-unit", "executed"]
  ]);
  assert.equal(kernel.getObject("ally").buffs, 1);
  assert.deepEqual(kernel.events.map(event => event.action), ["buff"]);
});

test("unl-029-219 Red Brambleback golden: a unit that already has a Buff is not Buffed again (CR 702.3)", () => {
  const kernel = fixtureWith({ allyBuffs: 1 });
  kernel.setTargets(targetSpec.id, [kernel.ref("ally")]);
  const outcome = resolveChainBody(BUFF_BODY, kernel);

  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("ally").buffs, 1);
  assert.deepEqual(kernel.events, []);
});

test("unl-029-219 Red Brambleback golden: the merged effect.buff alone performs the card's Buff", () => {
  const kernel = fixtureWith({ allyBuffs: 0 });
  const run = runInstruction(
    buff,
    { mode: "buff", target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [kernel.ref("ally")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.buffedCount, 1);
  assert.equal(kernel.getObject("ally").buffs, 1);
});

test("unl-029-219 Red Brambleback: the scoring wave publishes no conquering unit, so the self filter cannot match (gap 1)", () => {
  // Evidence for gap (1): the real conquer emission from turn/flow.ts carries a
  // player and a battlefieldId only; the translated object filter on this unit
  // therefore never matches (CR 383.4.c.2).
  const translated = translateTriggerFilter(
    conquerTrigger.trigger.filter,
    "brambleback",
    conquerTrigger.trigger.at
  );
  const emission = { timingPoint: "conquer", player: "A", details: { battlefieldId: "bf-1" } };
  assert.equal(matchesTriggerEvent(translated, emission, "A"), false,
    "the scoring wave has no conquering-unit attribution to match");
  assert.equal(matchesTriggerEvent(translated, { ...emission, object: unitSnapshot() }, "A"), true,
    "the same filter matches when the conquering unit is present");
});

test("unl-029-219 Red Brambleback golden: the whole triggered ability needs a host object on the emission (gap 1)", () => {
  // The card's own trigger body run through the interpreter is correct; the
  // subscription is what cannot fire, so the XP-free Buff never lands on a real
  // conquer.
  const kernel = fixtureWith({ allyBuffs: 0 });
  kernel.setTargets(targetSpec.id, [kernel.ref("ally")]);
  const outcome = resolveChainBody(BUFF_BODY, kernel);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("ally").buffs, 1);
  // ...but no self subscription can be registered for a bare conquer wave.
  const emission = { timingPoint: "conquer", player: "A", details: { battlefieldId: "bf-1" } };
  assert.equal(matchesTriggerEvent(
    translateTriggerFilter(conquerTrigger.trigger.filter, "brambleback", conquerTrigger.trigger.at),
    emission,
    "A"
  ), false);
});

test("unl-029-219 Red Brambleback: the trigger-multiplicity declaration has no binder or consumer (gap 2)", () => {
  // Evidence for gap (2): the merged static binder rejects the declaration
  // twice over — first through staticTarget's appliesTo check, then through the
  // missing layer mapping for continuous.trigger-multiplicity (CR 383.4.g.2).
  const f = fixture({ cards: [{ id: "brambleback", cardId: CANONICAL_ID, types: ["unit"], energy: 4, power: ["Fury"], zone: "board", location: { type: "battlefield", id: "bf-1" } }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("brambleback"), to: "board", location: { type: "battlefield", id: "bf-1" } });
  const host = f.kernel.getObject("brambleback");
  const binder = createEngineStaticBinder(f.engine);
  assert.throws(
    () => binder.bindStatic(multiplicity, host),
    /Unsupported static appliesTo/
  );
  assert.throws(
    () => binder.bindStatic({ ...multiplicity, effect: { ...multiplicity.effect, appliesTo: undefined } }, host),
    /no layer mapping/
  );
});

test("unl-029-219 Red Brambleback: [Accelerate]'s expansion is not consumed by the card -> cost pipeline (gap 3)", () => {
  // Evidence for gap (3): the merged keyword expansion produces the accelerate
  // cost and entry-orientation replacement, but the card-program cost adapter
  // rejects the additional-cost shape and the static accelerate.cost effect has
  // no layer mapping (CR 805.2.b/805.6).
  const definition = keywordDefinitionsById.get("Accelerate");
  assert.ok(definition, "effects/keywords/Accelerate.ts must be registered");
  const expanded = expandProgram(executableProgram(), unitSnapshot());
  const costDeclaration = expanded.abilities.find(candidate => candidate.kind === "static" && candidate.effect.kind === "accelerate.cost");
  assert.ok(costDeclaration, "the keyword must expand an accelerate.cost declaration");
  assert.equal(costDeclaration.effect.cost.kind, "additional-cost");
  assert.equal(costDeclaration.effect.cost.optional, true);
  assert.deepEqual(costDeclaration.effect.cost.payments, [
    { kind: "energy", amount: { kind: "constant", value: 1 } },
    { kind: "power", amount: { kind: "constant", value: 1 } }
  ]);
  assert.throws(
    () => translateCost(costDeclaration.effect.cost, "brambleback", "play"),
    /Unsupported play cost field optional/
  );
  const f = fixture({ cards: [{ id: "brambleback", cardId: CANONICAL_ID, types: ["unit"], energy: 4, power: ["Fury"], zone: "board", location: { type: "battlefield", id: "bf-1" } }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("brambleback"), to: "board", location: { type: "battlefield", id: "bf-1" } });
  assert.throws(
    () => createEngineStaticBinder(f.engine).bindStatic(costDeclaration, f.kernel.getObject("brambleback")),
    /Static ability kind accelerate\.cost has no layer mapping/
  );
});

test("unl-029-219 Red Brambleback golden: the Accelerate entry replacement binds even though its cost half does not", () => {
  // 805.6 / 805.6.a: the expansion's second half is an object-enters-board
  // replacement that turns the exhausted entry ready. It binds through the
  // production replacement binder and rewrites a real move-zone onto the Board,
  // so only the cost half of [Accelerate] is still missing.
  const [, replacement] = keywordDefinitionsById.get("Accelerate").expand({
    host: { canonicalCardId: CANONICAL_ID }
  });
  const kernel = world()
    .unit("brambleback", {
      zone: "hand",
      types: ["unit"],
      power: ["Fury"],
      exhausted: false,
      cardId: CANONICAL_ID
    })
    .build();
  const hostRef = kernel.ref("brambleback");
  const bound = bindReplacement(replacement, hostRef, {
    host: { object: ref => kernel.object(ref), objects: () => kernel.objects, context: () => kernel },
    pipeline: { clock: { turn: 1 }, registerReplacement: () => {} }
  });

  // Hand -> Chain, then 143.4's default exhausted chain-zone entry state.
  assert.equal(kernel.perform({ type: "move-zone", object: hostRef, to: "chain" }).status, "done");
  const chainRef = kernel.ref("brambleback");
  assert.equal(kernel.perform({ type: "exhaust", object: chainRef }).status, "done");

  const entering = {
    type: "move-zone",
    object: chainRef,
    to: "base",
    location: { type: "base", player: "A" }
  };
  assert.equal(bound.registration.matches(entering, entering), true);
  const applied = bound.registration.apply(entering, entering);
  assert.deepEqual(applied.actions.map(action => action.type), ["ready", "move-zone"]);
  for (const action of applied.actions) assert.equal(kernel.perform(action).status, "done");
  const entered = kernel.getObject("brambleback");
  assert.equal(entered.zone, "board");
  assert.equal(entered.exhausted, false);
});

test("unl-029-219 Red Brambleback: the conquer payload still carries no conquering unit for the source filter", () => {
  // 383.4.c.2: the authored filter binds the trigger to *this* unit. The real
  // scoring wave publishes { player, details.battlefieldId } only, so the
  // translated self filter matches nothing; adding an object would make it
  // match. This pins gap (1) against the merged matcher rather than the
  // contract text.
  const translated = translateTriggerFilter(
    conquerTrigger.trigger.filter,
    "brambleback",
    conquerTrigger.trigger.at
  );
  const wave = { timingPoint: "conquer", player: "A", details: { battlefieldId: "bf-1" } };
  assert.equal(matchesTriggerEvent(translated, wave, "A"), false);
  assert.equal(matchesTriggerEvent(translated, { ...wave, object: unitSnapshot() }, "A"), true);
  // 471.1/473.2.a: the closed timing point itself is registered and triggerable.
  assert.equal(getTimingPoint(conquerTrigger.trigger.at).triggerable === false, false);
});

test("unl-029-219 Red Brambleback: the card's `source: self` anchor translates to the conquering unit's object filter", () => {
  // 383.4.c.2 scopes the ability to *this* unit. programs/filters.ts is the merged
  // translation the registration path uses: the source anchor becomes an object
  // filter on the unit. Binding that filter to a real conquer emission is the
  // separate gap recorded below.
  const translated = translateTriggerFilter(conquerTrigger.trigger.filter, "brambleback", "conquered");
  assert.deepEqual(translated, {
    event: "conquered",
    object: { objectId: "brambleback" }
  });
});

test.todo(
  "unl-029-219 Red Brambleback: trigger multiplicity for the named conquer effects of units here" +
    " (CR 383.4.g / 383.4.g.2 distinguishes a real Conquer from an activated trigger) — the six Ability" +
    " shapes have no trigger multiplier and the trigger-collection stage has no multiplicity interface"
);

test.todo(
  "unl-029-219 Red Brambleback: charge the Accelerate optional additional cost and apply the 805.6 enter-ready" +
    " replacement — the merged keyword expansion is not consumed by the card-program -> cost/replacement pipeline" +
    " (translateCost rejects additional-cost fields and accelerate.cost has no layer mapping)"
);

test.todo(
  "unl-029-219 Red Brambleback: a real conquer emission binds the conquering unit (CR 383.4.c.2) — the scoring" +
    " wave in turn/flow.ts publishes only player + battlefieldId, so the translated object filter has no" +
    " conquering-unit attribution to match (timing-points.ts declares no payloadFields for conquer)"
);
