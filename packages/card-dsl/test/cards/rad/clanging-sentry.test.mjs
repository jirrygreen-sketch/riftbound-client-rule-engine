// Scenario execution evidence: ../../templates/static-642.test.mjs.
// This file keeps the validation and identity checks plus the key structural
// assertions; the real execution path for this card lives in that template row.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/clanging-sentry.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { expandEffectiveKeywords, KeywordGrantLayerEngine } from "../../../../engine-core/dist/programs/keyword-grants.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";

const CANONICAL = "card.hash-664329985c0c826779032a079e87a5c433f6be42cbfb4f724f81fd89fcc9a90a";
const SOURCE_TEXT =
  "Your Mechs have [Disarm]. (When each of us attacks, give an enemy unit there -1 :rb_might: this turn.)";

const [grant] = program.abilities;

const registrations = (kernel) => kernel.continuousEffects.map((entry) => ({
  effect: entry.effect,
  duration: entry.duration,
  timestamp: 1
}));

// The registrations written by the executed body live on the scoped kernel the
// interpreter ran against, so both the object list and the effect list come from
// that same scoped world.
const keywordsOf = (kernel, id) =>
  createLayerEngine(kernel.objects, registrations(kernel)).evaluate(kernel.ref(id)).keywords;

/**
 * "Your Mechs": the controller's Board Mechs (190.6.c). Following the merged
 * rad/coalesced-energy and sfd/show-of-strength goldens, the execution scenarios
 * substitute the production "controller" placeholder with the concrete player id:
 * the reference kernel compares filter scalars literally, and resolving the
 * relative-player placeholder is the real Finalize/target pipeline's job.
 */
const FRIENDLY_MECHS = {
  type: "unit",
  tag: "Mech",
  controller: "A",
  zone: "board"
};

/**
 * The printed static ability's grant as one executable body instruction: the
 * merged continuous.grant-keyword primitive consumes Expr-valued arguments, so
 * the static effect's fields are wrapped as constants here (the production
 * CardProgram -> layer registration consumer that would do this wiring is the
 * dynamic keyword-consumption gaps recorded in judgeReason and the TODOs below).
 */
function grantInstruction(id) {
  return {
    id,
    op: "continuous.grant-keyword",
    args: {
      keyword: { kind: "constant", value: grant.effect.keyword },
      value: grant.effect.value,
      duration: { kind: "constant", value: "end-of-turn" },
      filter: { kind: "constant", value: FRIENDLY_MECHS }
    }
  };
}

function sentryWorld() {
  return world()
    .unit("mech", { owner: "A", tags: ["Mech"], zone: "board" })
    .unit("soldier", { owner: "A", zone: "board" })
    .unit("enemy-mech", { owner: "B", controller: "B", tags: ["Mech"], zone: "board" })
    .unit("clanging-sentry", { owner: "A", tags: ["Mech"], zone: "board" })
    .build();
}

test("rad-055-167 Clanging Sentry: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-055-167 Clanging Sentry: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The reason must name the actual remaining gap — the re-expansion
  // consumer is merged (RIFT-710) but is not the production layer engine, and
  // the attack-declared emitter plus the dynamic-trigger lifecycle binder are
  // still missing — not the already-merged static binder or grant instruction.
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /RIFT-710/);
  assert.match(program.judgeReason, /KeywordGrantLayerEngine/);
  assert.match(program.judgeReason, /not 是生产默认|不是生产默认/);
  // The current gap is both the dynamic-trigger lifecycle binder and the
  // missing attack-declared emitter; the reason must not claim a producer exists.
  assert.match(program.judgeReason, /attack-declared/);
  assert.match(program.judgeReason, /lifecycle binder/);
  assert.match(program.judgeReason, /combat-start-transaction/);
  // 831.2's summing path is name-checked with the measured same-spelling defect.
  assert.match(program.judgeReason, /831\.2/);
  assert.match(program.judgeReason, /applyKeyword/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-055-167 Clanging Sentry: one static grant of Disarm 1 to every friendly Mech", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(grant.kind, "static");
  assert.deepEqual(grant.effect, {
    kind: "continuous.grant-keyword",
    keyword: "disarm",
    // 831.1.c.3：印刷省略 Disarm 值，按 1；831.2 由关键词注册表把多个来源相加。
    value: { kind: "constant", value: 1 },
    filter: { type: "unit", tag: "Mech", controller: "controller", zone: "board" }
  });
  assert.equal(grant.condition, undefined);
});

test("rad-055-167 Clanging Sentry golden: the printed grant registers Disarm on friendly Mechs only", () => {
  const kernel = sentryWorld();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("clanging-sentry") });

  const outcome = runAbilityBody([grantInstruction("clanging-sentry.grant-disarm")], scoped);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [["clanging-sentry.grant-disarm", "executed"]]
  );
  // 478.1.a: one ability-layer registration per surviving matched object.
  assert.deepEqual(
    scoped.continuousEffects.map((entry) => [entry.effect.layer, entry.effect.effect.keyword, entry.effect.effect.keywordValue, entry.effect.filter.objectId]).sort(),
    [
      ["ability", "disarm", 1, "clanging-sentry"],
      ["ability", "disarm", 1, "mech"]
    ]
  );

  assert.deepEqual(keywordsOf(scoped, "mech"), [{ id: "disarm", value: 1 }]);
  assert.deepEqual(keywordsOf(scoped, "clanging-sentry"), [{ id: "disarm", value: 1 }]);
  // "Your Mechs": the other friendly unit and the opponent's Mech are untouched.
  assert.deepEqual(keywordsOf(scoped, "soldier"), []);
  assert.deepEqual(keywordsOf(scoped, "enemy-mech"), []);
});

test("rad-055-167 Clanging Sentry golden: a grant adds onto a Disarm value the unit already has", () => {
  // The merged primitive's combining path (CR 831.2): when the target already has
  // a Disarm value, continuous.grant-keyword keeps that value in the ability layer
  // and adds its own instance through the arithmetic companion, so 2 + 1 reads as
  // one Disarm 3 rather than two separate instances (831.1.d.1).
  const kernel = world().unit("mech", { owner: "A", tags: ["Mech"], zone: "board", keywords: [{ id: "disarm", value: 2 }] }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("mech") });

  const outcome = runAbilityBody([grantInstruction("clanging-sentry.grant-disarm")], scoped);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    scoped.continuousEffects.map((entry) => entry.effect.layer),
    ["ability", "arithmetic"]
  );
  assert.deepEqual(keywordsOf(scoped, "mech"), [{ id: "disarm", value: 3 }]);
});

test("rad-055-167 Clanging Sentry golden: the merged Disarm expansion deals -1 Might this turn", () => {
  // 831.1.d: the granted Disarm expands (keywords/Disarm.ts) to "when the host
  // attacks, give an enemy unit there -1 [M] this turn". Its own instruction
  // runs unchanged on the merged continuous.might primitive.
  const disarm = keywordDefinitionsById.get("Disarm");
  assert.equal(disarm.stacking, "sum");
  const [expanded] = disarm.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expanded.kind, "triggered");
  assert.equal(expanded.trigger.at, "attack-declared");
  const [instruction] = expanded.body;
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: -1 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(instruction.targets[0].filter, {
    type: "unit",
    zone: "board",
    controller: "opponent",
    sameLocationAs: "source"
  });

  const kernel = world()
    .unit("enemy", { owner: "B", controller: "B", might: 3, zone: "board" })
    .unit("src", { owner: "A" })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("src") });
  scoped.setTargets("disarm.enemy-unit", [kernel.ref("enemy")]);

  const outcome = runAbilityBody([{ ...instruction, targets: undefined }], scoped);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [["disarm.give-minus-might", "executed"]]
  );
  assert.deepEqual(
    scoped.continuousEffects.map((entry) => [entry.effect.effect.kind, entry.effect.effect.amount, entry.duration]),
    [["continuous.might", -1, { type: "end-of-turn" }]]
  );

  const layers = createLayerEngine(kernel.objects, registrations(scoped));
  assert.equal(layers.evaluate(kernel.ref("enemy")).might, 2);
  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.equal(layers.evaluate(kernel.ref("enemy")).might, 3);
});

test.todo(
  "rad-055-167 Clanging Sentry: dynamically consume a grant-keyword Disarm registration by " +
    "expanding and registering its 831.1.d attack trigger on attack-declared"
);

test.todo(
  "rad-055-167 Clanging Sentry: produce the attack-declared timing event from the combat flow " +
    "without the current combat-start-transaction block"
);

// --- 2026-10-18 re-sweep: the merged re-expansion is real but not production ---
test("rad-055-167 Clanging Sentry re-sweep: the merged re-expansion sums Disarm and builds the 831.1.d attack trigger", () => {
  // RIFT-710's expandEffectiveKeywords is the merged consumer for a granted
  // keyword: it merges instances through the KeywordDef (831.2) and returns the
  // expanded abilities. Measured here on the card's own printed value.
  const snapshot = world()
    .unit("mech", { owner: "A", tags: ["Mech"], zone: "board", keywords: [{ id: "Disarm", value: 3 }] })
    .build()
    .getObject("mech");

  const expansion = expandEffectiveKeywords(snapshot, [
    { kind: "grant", keywords: [{ id: "disarm", value: 1 }] }
  ]);

  // 831.2: the printed Disarm 3 and the granted Disarm 1 collapse into one
  // summed value, and the expansion yields exactly one attack trigger.
  assert.deepEqual(expansion.keywords, [{ id: "Disarm", value: 4 }]);
  assert.deepEqual(expansion.abilities.map(ability => [ability.kind, ability.trigger.at]), [
    ["triggered", "attack-declared"]
  ]);
});

test("rad-055-167 Clanging Sentry re-sweep: the production chain engine still runs the plain LayerEngine, so the grant never re-expands", () => {
  // ChainEngine defaults to LayerEngine (chain/engine.ts). The declared static
  // grant therefore only lands as a raw ability-layer keyword on that engine and
  // is never fed back through expandEffectiveKeywords; a granted triggered
  // Disarm can never be registered on attack-declared.
  const kernel = sentryWorld();
  const context = source => bindResolveContext(kernel, { source, controller: source.controller });
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => kernel.choose(request),
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: () => false
  });

  assert.equal(engine.layers.constructor.name, "LayerEngine");

  // The production binder registers the card's declared static grant, but the
  // registration only rewrites the keyword list; no keyword expansion is
  // produced and the layer engine exposes no keywordAbilities consumer at all.
  createEngineStaticBinder(engine).bindStatic(grant, kernel.getObject("clanging-sentry"));
  engine.layers.setObjects(kernel.objects);

  const granted = createLayerEngine(
    kernel.objects,
    engine.layers.registry.list().map(entry => ({ effect: entry.effect, duration: entry.duration, timestamp: 1 }))
  ).evaluate(kernel.ref("mech"));
  assert.deepEqual(granted.keywords, [{ id: "disarm", value: 1 }]);
  assert.equal(typeof engine.layers.keywordAbilities, "undefined");
});

test("rad-055-167 Clanging Sentry re-sweep: a granted triggered Disarm fails closed even on the re-expansion engine", () => {
  // Injecting the merged KeywordGrantLayerEngine is not enough on its own:
  // Disarm's KeywordDef expands to a triggered ability (831.1.d), and the
  // engine's staticEffects accepts only static expansions. It blocks instead of
  // silently dropping the attack trigger.
  const kernel = sentryWorld();
  const context = source => bindResolveContext(kernel, { source, controller: source.controller });
  const layers = new KeywordGrantLayerEngine(kernel.objects, { context });
  layers.addContinuous({
    id: "clanging-sentry.grant-disarm",
    layer: "ability",
    source: kernel.ref("clanging-sentry"),
    filter: { objectId: "mech", zone: "board", zoneEntryId: 1 },
    effect: { kind: "continuous.grant-keyword", keyword: "disarm", keywordValue: 1 }
  }, { type: "permanent" });

  assert.throws(
    () => layers.evaluate(kernel.ref("mech")),
    error => error.code === "judge-required" && /Dynamic triggered keyword abilities need a lifecycle binder/.test(error.message)
  );
});

test("rad-055-167 Clanging Sentry re-sweep: the production static binder overwrites a same-spelling printed Disarm instead of summing it (831.2)", () => {
  // This card grants through a *static* ability, so its production path is
  // bindStaticToLayers: one ability-layer registration with no arithmetic
  // companion. applyKeyword then looks the keyword up by exact id, so the
  // granted lowercase "disarm" replaces a printed lowercase "disarm" rather
  // than summing under 831.2. The uppercase printed spelling is stored as a
  // second instance and does sum once the merged re-expansion runs, so both
  // data-reachable spellings are pinned here. By contrast the instruction path
  // (continuous.grant-keyword) registers an arithmetic companion and sums
  // correctly; the goldens above cover that half.
  for (const [printed, expected, expanded] of [
    [[{ id: "disarm", value: 3 }], [{ id: "disarm", value: 1 }], [{ id: "Disarm", value: 1 }]],
    [[{ id: "Disarm", value: 3 }], [{ id: "Disarm", value: 3 }, { id: "disarm", value: 1 }], [{ id: "Disarm", value: 4 }]]
  ]) {
    const kernel = world()
      .unit("mech", { owner: "A", tags: ["Mech"], zone: "board", keywords: printed })
      .unit("clanging-sentry", { owner: "A", tags: ["Mech"], zone: "board" })
      .build();
    const host = createActionPipelineHost({
      checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
      restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
      objects: () => kernel.objects,
      perform: action => kernel.perform(action),
      choose: request => kernel.choose(request),
      context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
    });
    const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
    createEngineStaticBinder(engine).bindStatic(grant, kernel.getObject("clanging-sentry"));
    engine.layers.setObjects(kernel.objects);

    const entries = engine.layers.registry.list().map(entry => ({ effect: entry.effect, duration: entry.duration, timestamp: 1 }));
    // The printed value stays on the raw object snapshot; the layer rewrite is
    // what loses it. Capture both so the defect is unambiguous.
    assert.deepEqual(kernel.getObject("mech").keywords, printed);
    const evaluated = createLayerEngine(kernel.objects, entries).evaluate(kernel.ref("mech"));
    assert.deepEqual(evaluated.keywords, expected);
    assert.deepEqual(
      expandEffectiveKeywords({ ...kernel.getObject("mech"), keywords: evaluated.keywords }).keywords,
      expanded
    );
  }
});
