import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/scorchclaw.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/index.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-2958889db75762be77762e57c20843ec822b4e17041923975b21d9edc0fd4494";
const SOURCE_TEXT =
  "[Hunt 2] (When I conquer or hold, gain 2 XP.)\n" +
  "[Level 3][>] I have +1 :rb_might: and enter ready. (While you have 3+ XP, get the effect.)";

const [hunt, levelMight, levelEnterReady] = program.abilities;
const enterReadyInstruction = levelEnterReady.with[0];

const executableProgram = () => ({ ...program, status: "executable", judgeReason: undefined });
const unitSnapshot = (overrides = {}) => ({
  ref: { id: "scorchclaw", zoneEntryId: 1 }, cardId: CANONICAL_ID, name: "Scorchclaw",
  types: ["unit"], tags: [], keywords: [{ id: "Level", value: 3 }, { id: "Hunt", value: 2 }],
  owner: "A", controller: "A", zone: "board", location: { type: "base", player: "A" },
  might: 3, energy: 3, power: ["Fury"], exhausted: false, damage: 0, stunned: false, buffs: 0,
  attachedTo: null, faceDown: false, isToken: false, combatRole: null,
  ...overrides
});

test("unl-016-219 Scorchclaw: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-016-219 Scorchclaw: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Hunt/);
  assert.match(program.judgeReason, /823\.1\.c\.1/);
  assert.match(program.judgeReason, /battlefieldId/);
  assert.match(program.judgeReason, /824\.1/);
  assert.match(program.judgeReason, /condition\.predicate/);
  assert.match(program.judgeReason, /RIFT-359/);
  // The merged pieces are named as merged instead of being listed as blockers.
  assert.match(program.judgeReason, /continuous\.might、replacement\.enter 与 programs\/ 的图层\/替代绑定均已合入/);
});

test("unl-016-219 Scorchclaw: [Hunt 2] declares the printed Hunt Value as a keyword only", () => {
  assert.equal(program.abilities.length, 3);
  // 823.1.b / 823.1.c: Hunt is both a Conquer and a Hold effect formatted as
  // "Hunt X"; the printed X is 2 (823.1.c.2's default of 1 does not apply).
  assert.deepEqual(hunt, { kind: "keyword", keyword: "hunt", value: 2 });
  // README section 5: the conquer/hold trigger and "gain X XP" expansion belong
  // to effects/keywords/Hunt.ts, not to this card file; the card declares only
  // the keyword and its value.
  assert.equal(Object.keys(hunt).sort().join(","), "keyword,kind,value");
});

test("unl-016-219 Scorchclaw: [Level 3][>] carries the +1 Might branch gated on 3 XP", () => {
  // 824.1.b / 824.1.b.1: the whole clause after the keyword is the Level Ability,
  // functionally "While you have 3 or more XP, this card gains '[Text]'".
  assert.equal(levelMight.kind, "static");
  assert.equal(levelMight.effect.kind, "continuous.might");
  assert.equal(levelMight.effect.mode, "add");
  assert.equal(levelMight.effect.layer, "arithmetic");
  assert.equal(levelMight.effect.appliesTo, "self");
  assert.deepEqual(levelMight.effect.amount, { kind: "constant", value: 1 });
  assert.equal(levelMight.condition.kind, "compare");
  assert.equal(levelMight.condition.operator, "gte");
  assert.deepEqual(levelMight.condition.right, { kind: "constant", value: 3 });
  assert.equal(levelMight.condition.left.kind, "count");
  assert.equal(levelMight.condition.left.subject, "controller-xp");
});

test("unl-016-219 Scorchclaw: [Level 3][>] also carries the enter-ready branch at the same 3 XP gate", () => {
  // 824.1.b.1: "and enter ready" is the second part of the same Level Ability; it
  // is an entry replacement (359.2.c / 369.3), not a post-entry effect.ready.
  assert.equal(levelEnterReady.kind, "replacement");
  assert.deepEqual(levelEnterReady.replaces, {
    event: "object-enters-board",
    filter: { self: true, exhausted: true }
  });
  assert.equal(levelEnterReady.condition.kind, "compare");
  assert.equal(levelEnterReady.condition.operator, "gte");
  assert.deepEqual(levelEnterReady.condition.right, { kind: "constant", value: 3 });
  assert.equal(levelEnterReady.condition.left.subject, "controller-xp");
  assert.equal(levelEnterReady.with.length, 1);
  assert.equal(enterReadyInstruction.id, "scorchclaw.enter-ready");
  assert.equal(enterReadyInstruction.op, "effect.ready");
  assert.deepEqual(enterReadyInstruction.args.objects, {
    kind: "constant",
    value: { kind: "source" }
  });
});

test("unl-016-219 Scorchclaw: the replacement body's effect.ready readies the source", () => {
  const kernel = world()
    .unit("scorchclaw", { zone: "board", controller: "A", exhausted: true, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("scorchclaw")) });
  const outcome = resolveChainBody(levelEnterReady.with, scoped);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["scorchclaw.enter-ready", "executed"]
  ]);
  assert.deepEqual(scoped.events.map(event => event.action), ["ready"]);
  assert.equal(scoped.object(scoped.ref("scorchclaw")).exhausted, false);
});

test("unl-016-219 Scorchclaw golden: the merged [Hunt 2] expansion pays 2 XP through the interpreter (CR 823.1.c.1)", () => {
  // 823.1.c.1: Hunt is "When I Conquer or Hold, my controller gains X XP"; the
  // merged KeywordDef expands it into one trigger per timing point whose body is
  // the merged effect.xp primitive. The subscription side stays open below.
  const huntDefinition = keywordDefinitionsById.get("Hunt");
  assert.ok(huntDefinition, "effects/keywords/Hunt.ts must be registered");
  assert.equal(huntDefinition.stacking, "sum");
  const expansions = huntDefinition.expand({ value: hunt.value, host: { canonicalCardId: CANONICAL_ID } });
  assert.deepEqual(expansions.map((ability) => ability.trigger.at), ["conquer", "hold"]);

  for (const ability of expansions) {
    const kernel = world().player("A", { xp: 0 }).build();
    const outcome = resolveChainBody(ability.body, kernel);
    assert.equal(outcome.results[0].result.status, "executed");
    // 823.1.c.2: the printed X is 2, so the omitted-value default of 1 is unused.
    assert.equal(outcome.results[0].result.linkedValues.gained, 2);
    assert.equal(kernel.player("A").xp, 2);
  }
});

test("unl-016-219 Scorchclaw golden: the Level +1 Might registers a real arithmetic-layer continuous effect (CR 143.2.a / 475)", () => {
  // The card's own static ability (not the aggregate declaration) is exercised:
  // its continuous.might instruction is executed by the merged interpreter and
  // the registration is consumed by the switched-on layer engine.
  const instruction = {
    id: "scorchclaw.level-might",
    op: "continuous.might",
    args: {
      mode: levelMight.effect.mode,
      amount: levelMight.effect.amount,
      objects: { kind: "constant", value: { kind: "target", id: "scorchclaw.self" } }
    },
    targets: [
      {
        id: "scorchclaw.self",
        filter: { type: "unit" },
        min: 1,
        max: 1,
        selection: "one"
      }
    ]
  };
  const kernel = world().unit("scorchclaw", { owner: "A", might: 3 }).build();
  kernel.setTargets("scorchclaw.self", [kernel.ref("scorchclaw")]);
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("scorchclaw") });
  const outcome = resolveChainBody([instruction], context);
  assert.equal(outcome.results[0].result.status, "executed");

  const registrations = context.continuousEffects.map((entry, index) => ({
    effect: entry.effect,
    duration: entry.duration,
    timestamp: index + 1
  }));
  const layered = createLayerEngine(context.objects, registrations).evaluate(context.ref("scorchclaw"));
  assert.equal(layered.might, 4);
  assert.equal(registrations[0].effect.effect.kind, "continuous.might");
  assert.equal(registrations[0].effect.layer, "arithmetic");
});

test("unl-016-219 Scorchclaw: the generated card registry exposes the program under its canonical id", () => {
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-016-219 Scorchclaw golden: a prevented ready body leaves the source exhausted", () => {
  const base = world().unit("scorchclaw", { exhausted: true }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("scorchclaw") });
  kernel.addReplacement(action => action.type === "ready" ? "prevented" : null);
  const outcome = resolveChainBody(levelEnterReady.with, kernel);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(kernel.getObject("scorchclaw").exhausted, true);
  assert.deepEqual(outcome.events.map(event => ({ action: event.action, outcome: event.outcome })), [
    { action: "ready", outcome: "prevented" }
  ]);
});

test("unl-016-219 Scorchclaw: the real conquer emission carries no Hunt host, so the subscription never matches (gap 1)", () => {
  // Evidence for gap (1): turn/flow.ts publishes conquer with only a
  // battlefieldId detail; programs/triggers.ts translates { source: "self" } into
  // an object filter on this unit, which cannot match an event without the
  // conquering unit (CR 823.1.c.1).
  const expanded = expandProgram(executableProgram(), unitSnapshot());
  for (const ability of expanded.abilities.filter(candidate => candidate.kind === "triggered")) {
    const translated = translateTriggerFilter(ability.trigger.filter, "scorchclaw", ability.trigger.at);
    assert.deepEqual(translated, { event: ability.trigger.at, object: { objectId: "scorchclaw" } });
    const bareEmission = {
      timingPoint: ability.trigger.at,
      player: "A",
      details: { battlefieldId: "bf-1" }
    };
    assert.equal(matchesTriggerEvent(translated, bareEmission, "A"), false,
      "an emission without the host object must not satisfy the self filter");
    assert.equal(matchesTriggerEvent(translated, { ...bareEmission, object: unitSnapshot() }, "A"), true,
      "the same filter matches once the conquering unit is present");
  }
});

test("unl-016-219 Scorchclaw golden: the XP gate cannot be evaluated by the merged Condition vocabulary (gap 2)", () => {
  // Evidence for gap (2): the count expression counts objects, not the
  // controller's XP. Four unrelated objects make the gte-3 clause true, and two
  // objects make it false, with XP unchanged.
  const environment = kernel => ({
    context: kernel,
    host: kernel.ref("scorchclaw"),
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false
  });
  const fourObjects = world()
    .player("A", { xp: 0 })
    .unit("scorchclaw")
    .unit("a").unit("b").unit("c")
    .build();
  const twoObjects = world().player("A", { xp: 0 }).unit("scorchclaw").unit("a").build();
  assert.equal(evaluateCondition(levelMight.condition, environment(fourObjects)), true);
  assert.equal(evaluateCondition(levelMight.condition, environment(twoObjects)), false);
  for (const kernel of [fourObjects, twoObjects]) assert.equal(kernel.player("A").xp, 0);
  assert.equal(levelMight.condition.left.subject, "controller-xp",
    "the authored subject records the intended XP gate that no evaluator reads");
});

test("unl-016-219 Scorchclaw: the Level predicate expansion has no layer mapping (gap 2)", () => {
  // Evidence for gap (2): programs/statics.ts rejects the expanded
  // condition.predicate, so the dependent ability cannot be bound to a live XP
  // gate (CR 824.1.b.1/824.1.c/824.1.d).
  const snapshot = unitSnapshot();
  const expanded = expandProgram(executableProgram(), snapshot);
  const predicate = expanded.abilities.find(candidate => candidate.kind === "static" && candidate.effect.kind === "condition.predicate");
  assert.ok(predicate, "the Level keyword must expand to a condition.predicate");
  assert.equal(predicate.effect.query, "controller-xp");
  const f = fixture({ cards: [{ id: "scorchclaw", cardId: CANONICAL_ID, types: ["unit"], energy: 3, power: ["Fury"], zone: "board" }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("scorchclaw"), to: "board", location: { type: "base", player: "A" } });
  assert.throws(
    () => createEngineStaticBinder(f.engine).bindStatic(predicate, f.kernel.getObject("scorchclaw")),
    /Static ability kind condition\.predicate has no layer mapping/
  );
});

test("unl-016-219 Scorchclaw: matchesEnterAction ignores the ability condition (gap 3)", () => {
  // Evidence for gap (3): replacement/bind.ts's entry branch does not consult
  // ability.condition, so the XP-gated "enter ready" cannot be shown to respect
  // its gate (RIFT-359 bridge).
  const withNever = { ...levelEnterReady, condition: { kind: "never" } };
  const entries = [];
  for (const [label, ability] of [["never", withNever], ["always", { ...levelEnterReady, condition: { kind: "always" } }]]) {
    const f = fixture({ cards: [{ id: "scorchclaw", cardId: CANONICAL_ID, types: ["unit"], energy: 3, power: ["Fury"], zone: "hand" }] });
    // Bind from the printed zone so the registration follows the host onto the
    // Chain, exactly as the merged lifecycle attaches replacements.
    const handle = createEngineStaticBinder(f.engine).bindReplacement(ability, f.kernel.getObject("scorchclaw"));
    f.engine.commit({ type: "move-zone", object: f.kernel.ref("scorchclaw"), to: "chain" });
    const onChain = f.kernel.getObject("scorchclaw");
    // CR 359.2.c makes the entering Unit exhausted; the entry filter reads it.
    f.kernel.addObject({ ...onChain, exhausted: true });
    const host = f.kernel.getObject("scorchclaw");
    const entry = { type: "move-zone", object: host.ref, to: "base", location: { type: "base", player: "A" } };
    entries.push([label, f.engine.pipeline.commit(entry).status]);
    handle?.unbind?.();
  }
  // Both gates behave identically: the condition is not consulted on this path.
  assert.deepEqual(entries, [["never", "replaced"], ["always", "replaced"]]);
});

test.todo(
  "unl-016-219 Scorchclaw: preserve the Hunt host unit on real conquer/hold emissions so the self trigger can gain 2 XP (CR 823.1.c.1); the timing points and program subscriptions already exist"
);
test.todo(
  "unl-016-219 Scorchclaw: read live controller XP for both Level branches, including changes of controller and XP loss (CR 824.1.b.1/824.1.c/824.1.d; RIFT-359)"
);
test.todo(
  "unl-016-219 Scorchclaw: evaluate the XP condition before the entry-orientation replacement in matchesEnterAction (CR 824.1/369.3; RIFT-359)"
);
