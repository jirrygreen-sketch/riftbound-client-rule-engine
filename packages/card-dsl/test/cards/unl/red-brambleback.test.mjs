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

function fixture({ allyBuffs } = {}) {
  const base = world()
    .unit("brambleback", { might: 4 })
    .unit("ally", { might: 2, owner: "A", buffs: allyBuffs })
    .build();
  return base.clone({ sourceSnapshot: base.getObject("brambleback") });
}

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
  // The newly verified gap: the scoring wave carries no conquering-unit attribution.
  assert.match(program.judgeReason, /payloadFields/);
  assert.match(program.judgeReason, /sigil-of-the-storm/);
  // The closed EventPattern spelling and the pipeline alias are both named.
  assert.match(program.judgeReason, /pipeline-match/);
  assert.match(program.judgeReason, /conquered/);
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
  const kernel = fixture({ allyBuffs: 0 });
  kernel.setTargets(targetSpec.id, [kernel.ref("ally")]);
  const outcome = resolveChainBody(BUFF_BODY, kernel);

  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["red-brambleback.buff-friendly-unit", "executed"]
  ]);
  assert.equal(kernel.getObject("ally").buffs, 1);
  assert.deepEqual(kernel.events.map(event => event.action), ["buff"]);
});

test("unl-029-219 Red Brambleback golden: a unit that already has a Buff is not Buffed again (CR 702.3)", () => {
  const kernel = fixture({ allyBuffs: 1 });
  kernel.setTargets(targetSpec.id, [kernel.ref("ally")]);
  const outcome = resolveChainBody(BUFF_BODY, kernel);

  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("ally").buffs, 1);
  assert.deepEqual(kernel.events, []);
});

test("unl-029-219 Red Brambleback golden: the merged effect.buff alone performs the card's Buff", () => {
  const kernel = fixture({ allyBuffs: 0 });
  const run = runInstruction(
    buff,
    { mode: "buff", target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [kernel.ref("ally")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.buffedCount, 1);
  assert.equal(kernel.getObject("ally").buffs, 1);
});

test.todo(
  "unl-029-219 Red Brambleback: trigger multiplicity for the named conquer effects of units here" +
    " (CR 383.4.g / 383.4.g.2 distinguishes a real Conquer from an activated trigger) — the six Ability" +
    " shapes have no trigger multiplier and the trigger-collection stage has no multiplicity interface"
);
test.todo(
  "unl-029-219 Red Brambleback: charge the Accelerate optional additional cost and apply the 805.6 enter-ready" +
    " replacement — the merged keyword expansion is not consumed by the card-program -> cost/replacement pipeline" +
    " (programs/play.ts rejects additional-cost fields)"
);
test.todo(
  "unl-029-219 Red Brambleback: the conquer trigger is registered and its friendly-unit target is locked at" +
    " Finalize — the RIFT-257 registration path exists, but the program is judge-required so the registry refuses" +
    " it; the card keeps judge-required for the trigger-multiplicity gap recorded in judgeReason"
);

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
  "unl-029-219 Red Brambleback: a real conquer emission binds the conquering unit (CR 383.4.c.2) — the scoring " +
    "wave in turn/flow.ts publishes only player + battlefieldId, so the translated object filter has no " +
    "conquering-unit attribution to match (timing-points.ts declares no payloadFields for conquer)"
);
