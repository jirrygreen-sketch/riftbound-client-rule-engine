import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/khazix-mutating-horror.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/engine.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { registerProgramTriggers, triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { createActionPipelineHost, bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CARD_ID =
  "card.hash-6080c717cf342299d6073468f9de4f808e7a244d4edd6bbe1ec9d6a519127a24";
const SOURCE_TEXT =
  "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
  "When I attack or defend, if an enemy unit is alone here, give me +2 :rb_might: this turn and gain 2 XP.";

const [ambush, attackTrigger, defendTrigger] = program.abilities;
const [attackGrant, attackGainXp] = attackTrigger.body;
const [defendGrant, defendGainXp] = defendTrigger.body;

const ALONE_ENEMY_HERE_COUNT = {
  kind: "count",
  subject: "alone-enemy-units-here",
  filter: { type: "unit", controller: "opponent", sameLocationAs: "source" }
};

test("unl-143-219 Kha'Zix, Mutating Horror: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-143-219 Kha'Zix, Mutating Horror: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /attack-declared/);
  assert.match(program.judgeReason, /Ambush/);
  // The merged subscription path is recorded as executable; the live gaps name
  // the missing combat producer and the unconsumed relative-location anchor.
  assert.match(program.judgeReason, /matchesFilter/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /383\.2\.a\.1/);
  assert.equal(/待实现|需要裁定/.test(program.judgeReason), false);
});

test("unl-143-219 Kha'Zix, Mutating Horror: unvalued Ambush plus attack and defend triggers", () => {
  assert.equal(program.abilities.length, 3);
  // 822.1.b / 822.2: Ambush is passive and redundant when repeated, so no value is printed.
  assert.deepEqual(ambush, { kind: "keyword", keyword: "ambush" });

  assert.equal(attackTrigger.trigger.at, "attack-declared");
  assert.deepEqual(attackTrigger.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(defendTrigger.trigger.at, "defense-declared");
  assert.deepEqual(defendTrigger.trigger.filter, {
    event: "defense-declared",
    filter: { source: "self" }
  });
  assert.equal(attackTrigger.optional, false);
  assert.equal(defendTrigger.optional, false);
});

test("unl-143-219 Kha'Zix, Mutating Horror: 'if an enemy unit is alone here' is the Trigger Condition (383.2.a.1)", () => {
  // 740.2.a defines "alone" as no other friendly unit at the same location; "here" is the source's
  // location (359.3.f), so exactly one enemy unit at that location fulfils the clause.
  assert.deepEqual(attackTrigger.trigger.condition, {
    kind: "compare",
    left: ALONE_ENEMY_HERE_COUNT,
    operator: "eq",
    right: { kind: "constant", value: 1 }
  });
  assert.deepEqual(defendTrigger.trigger.condition, attackTrigger.trigger.condition);
});

test("unl-143-219 Kha'Zix, Mutating Horror: +2 Might this turn plus gain 2 XP as two independent steps", () => {
  for (const [grant, gain, prefix] of [
    [attackGrant, attackGainXp, "khazix-mutating-horror.grant-might"],
    [defendGrant, defendGainXp, "khazix-mutating-horror.defend-grant-might"]
  ]) {
    assert.equal(grant.id, prefix);
    assert.equal(grant.op, "continuous.might");
    assert.deepEqual(grant.args.amount, { kind: "constant", value: 2 });
    assert.deepEqual(grant.args.duration, { kind: "constant", value: "this-turn" });
    // "me" is the ability host (355.10.d): the appliesTo self selector, never a fabricated target.
    assert.deepEqual(grant.args.appliesTo, { kind: "constant", value: "self" });
    assert.equal(grant.targets, undefined);

    // 359.3.e.14.c: "and gain 2 XP" is its own instruction and does not link to the Might half.
    assert.equal(gain.op, "effect.xp");
    assert.deepEqual(gain.args, { amount: { kind: "constant", value: 2 } });
    assert.equal(gain.linkedTo, undefined);
  }
});

test("unl-143-219 Kha'Zix, Mutating Horror golden: the gain 2 XP half really grants 2 XP", () => {
  const kernel = world().build();
  const outcome = resolveChainBody([attackGainXp], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["khazix-mutating-horror.gain-xp", "executed"]
  ]);
  assert.equal(kernel.player("A").xp, 2);
  assert.equal(kernel.player("B").xp, 0);
  assert.equal(outcome.linkedValues["khazix-mutating-horror.gain-xp.gainedTo"], "A");
  assert.deepEqual(outcome.events.map(event => event.action), ["gain-xp"]);
});

test("unl-143-219 Kha'Zix, Mutating Horror golden: +2 Might registers for this turn and expires", () => {
  const base = world()
    .unit("khazix", { owner: "A", controller: "A", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("khazix"), controller: "A" });
  const outcome = resolveChainBody([attackGrant], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["khazix-mutating-horror.grant-might", "executed"]
  ]);
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 2);
  assert.equal(registration.effect.filter.objectId, "khazix");
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.equal(layers.evaluate(kernel.ref("khazix")).might, 6);
  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.equal(layers.evaluate(kernel.ref("khazix")).might, 4);
});

test("unl-143-219 Kha'Zix, Mutating Horror: both declared triggers register in production with the host anchor", () => {
  // 383.4.e / 383.4.f: attack-declared and defense-declared are part of the
  // closed EVENT_PATTERN_TYPES vocabulary, and programs/filters.ts normalizes
  // source:"self" to this host, so both subscriptions install.
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const f = fixture({ cards: [{ id: "khazix", cardId: CARD_ID, types: ["unit"], might: 4 }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("khazix"), to: "battlefield", location: { type: "battlefield", id: "battlefield-1" } });
  const source = f.kernel.getObject("khazix");
  assert.deepEqual(
    triggerRegistrations(binding.registry, source).map(entry => [entry.spec.at, entry.spec.filter]),
    [
      ["attack-declared", { event: "attack-declared", object: { objectId: "khazix" } }],
      ["defense-declared", { event: "defense-declared", object: { objectId: "khazix" } }]
    ]
  );
  assert.deepEqual(
    registerProgramTriggers(binding.registry, f.engine, source),
    [`program:khazix:${source.ref.zoneEntryId}:1`, `program:khazix:${source.ref.zoneEntryId}:2`]
  );
});

test("unl-143-219 Kha'Zix, Mutating Horror gap: the 'alone here' condition is fail-closed on the production host query", () => {
  // 383.2.a.1 / 740.2.a: the condition counts enemy units at the source's
  // location. Without a testTrigger bridge the EventPipeline evaluates it
  // through PipelineHost.context().query; that host surface compares
  // controller/owner literally and does not resolve sameLocationAs, so the
  // condition is false even with exactly one enemy unit here.
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const f = fixture({ cards: [{ id: "khazix", cardId: CARD_ID, types: ["unit"], might: 4 }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("khazix"), to: "battlefield", location: { type: "battlefield", id: "battlefield-1" } });
  const source = f.kernel.getObject("khazix");
  const [registration] = triggerRegistrations(binding.registry, source);
  const condition = registration.spec.condition;
  assert.deepEqual(condition.left.filter, {
    type: "unit",
    controller: "opponent",
    sameLocationAs: "source"
  });

  const evaluate = kernel => {
    const host = createActionPipelineHost({
      checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
      restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
      objects: () => kernel.objects,
      perform: action => kernel.perform(action),
      choose: request => kernel.choose(request),
      context: (snapshot, controller, timingPoint) => bindResolveContext(kernel, { source: snapshot, controller, timingPoint })
    });
    const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
    // EventPipeline.scan without a testTrigger bridge uses PipelineHost.context.
    const context = host.context(kernel.getObject("khazix"), "A", "attack-declared");
    return evaluateCondition(condition, {
      context,
      event: {},
      linked: key => context.linked(key),
      canLookBack: () => true,
      isIgnored: () => false,
      query: filter => context.query(filter)
    });
  };

  const alone = world()
    .unit("khazix", { owner: "A", controller: "A", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-here", { owner: "B", controller: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const far = world()
    .unit("khazix", { owner: "A", controller: "A", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-far", { owner: "B", controller: "B", might: 3, location: { type: "battlefield", id: "bf-9" } })
    .build();
  assert.equal(alone.query({ type: "unit", controller: "opponent", sameLocationAs: "source" }).length, 0);
  // Both boards evaluate false: the host query cannot express "here", so the
  // printed condition can never become true through this path.
  assert.equal(evaluate(alone), false);
  assert.equal(evaluate(far), false);
  assert.equal(alone.query({ type: "unit", controller: "B" }).length, 1);
});

test.todo(
  "unl-143-219 Kha'Zix, Mutating Horror: fire the attack-declared / defense-declared triggers from the real " +
    "combat workflow (CR 383.4.e / 383.4.f) so the supported Might and XP body enters the chain"
);
test.todo(
  "unl-143-219 Kha'Zix, Mutating Horror: [Ambush] (CR 822.1.b/822.1.c) is consumed by the play flow for its " +
    "valid battlefield locations and Reaction permission"
);
test.todo(
  "unl-143-219 Kha'Zix, Mutating Horror: the 'if an enemy unit is alone here' condition resolves its " +
    "sameLocationAs anchor through the production host query (the reference kernel and EngineRuntimeHost " +
    "currently only compare zone/type/owner/controller)"
);
