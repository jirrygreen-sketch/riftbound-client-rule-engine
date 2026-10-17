// Golden test for Watchful Curator (rad-037-167).
//
// Scenario execution evidence: ../templates/static-642.test.mjs.
// This file keeps the validation/identity checks and the key structural
// assertions; the real execution path for this card lives in that template row.
//
// judge-required: the static grant of [Deflect] is executable, but the target-tax
// production and any-domain Power payment chain is still missing.
// The production evidence is createEngineStaticBinder().bindStatic registering
// the grant as a ContinuousEffectSpec; the runnable evidence is the merged
// continuous.grant-keyword instruction and the real LayerEngine applying the
// granted keyword, including the CR 809.2 addition to an existing Deflect value.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/watchful-curator.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import grantKeyword from "../../../../engine-core/dist/effects/instructions/continuous.grant-keyword.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";

const CANONICAL =
  "card.hash-dc5774a38ed543aac39bd40a45c96e08acddedf25a91e979a8a3576715ec1a5b";
const SOURCE_TEXT =
  "Your gear have [Deflect]. (Opponents must pay :rb_rune_rainbow: to choose each with a spell or ability.)";
const GRANT_TARGET = "watchful-curator.gear";

const [grant] = program.abilities;

/** A minimal board object for the real layer engine. */
function boardObject(id, types, values = {}) {
  return {
    ref: { id, zoneEntryId: 1 },
    cardId: id,
    name: id,
    types,
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "base", player: "A" },
    might: null,
    energy: 2,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false,
    ...values
  };
}

/** Run the card's declared grant through the merged primitive + layer engine. */
function grantTo({ gearKeywords = [], grantValue = grant.effect.value.value } = {}) {
  const kernel = world()
    .object("curator", { types: ["unit"], zone: "board", might: 4 })
    .object("gear", { types: ["gear"], zone: "board", keywords: gearKeywords })
    .object("other-gear", { types: ["gear"], zone: "board" })
    .object("enemy-gear", { types: ["gear"], zone: "board", owner: "B", controller: "B" })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("curator") });
  scoped.setTargets(GRANT_TARGET, [scoped.ref("gear")]);
  // 本卡 static 的 effect 未写 target 参数（其范围由 filter 描述、生产接线按匹配集授予）。
  // 这里按已合入原语的 target 选择路径执行同一 keyword/value/duration 形状。
  const outcome = runAbilityBody([
    {
      id: "watchful-curator.grant-deflect",
      op: "continuous.grant-keyword",
      args: {
        keyword: { kind: "constant", value: grant.effect.keyword },
        value: { kind: "constant", value: grantValue },
        target: { kind: "constant", value: GRANT_TARGET }
      },
      targets: [
        {
          id: GRANT_TARGET,
          filter: { type: "gear", zone: "board" },
          min: 1,
          max: 1,
          selection: "one"
        }
      ]
    }
  ], scoped);
  const engine = createLayerEngine(
    scoped.listObjects(),
    scoped.continuousEffects.map(entry => ({ effect: entry.effect, duration: entry.duration }))
  );
  return { outcome, scoped, engine };
}

test("rad-037-167 Watchful Curator: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-037-167 Watchful Curator: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /options\.tax/);
  assert.match(program.judgeReason, /任意域 Power/);
  assert.doesNotMatch(program.judgeReason, /RIFT-360/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-037-167 Watchful Curator: one static grant of Deflect 1 to your gear", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(grant.kind, "static");
  assert.equal(grant.effect.kind, "continuous.grant-keyword");
  // 809.1.b.3: priority is Deflect 1 when the printed number is omitted.
  assert.deepEqual(grant.effect.value, { kind: "constant", value: 1 });
  assert.equal(grant.effect.layer, "ability");
  // "Your gear": gear controlled by this card's controller, on the board.
  assert.deepEqual(grant.effect.filter, {
    type: "gear",
    controller: "controller",
    zone: "board"
  });
});

test("rad-037-167 Watchful Curator: the grant scope covers your gear and nothing else", () => {
  // The declared static IR keeps "controller" as the symbolic controller
  // placeholder (as the sibling card programs do). The consumers resolve it
  // against the live ability controller, which the layer filter spells as an
  // explicit player id (events/trigger-spec.ts PlayerSelector).
  const resolved = { ...grant.effect.filter, controller: { playerId: "A" } };
  const gear = boardObject("gear", ["gear"]);
  const unit = boardObject("unit", ["unit"], { might: 4 });
  const enemyGear = boardObject("enemy-gear", ["gear"], { owner: "B", controller: "B" });
  assert.equal(matchesObjectFilter(resolved, gear), true);
  assert.equal(matchesObjectFilter(resolved, unit), false);
  assert.equal(matchesObjectFilter(resolved, enemyGear), false);
  assert.equal(grant.effect.filter.controller, "controller");
});

test("rad-037-167 Watchful Curator: the merged grant primitive really puts Deflect 1 on the gear (809.3)", () => {
  const { outcome, scoped, engine } = grantTo();
  assert.equal(outcome.status, "executed", JSON.stringify(outcome.results));
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["watchful-curator.grant-deflect", "executed"]
  ]);
  assert.equal(scoped.continuousEffects.length, 1);
  const registration = scoped.continuousEffects[0];
  assert.equal(registration.effect.layer, "ability");
  assert.equal(registration.effect.effect.kind, "continuous.grant-keyword");
  assert.equal(registration.effect.effect.keyword, "deflect");
  assert.equal(registration.effect.effect.keywordValue, 1);
  // 809.3: the granted keyword is a readable characteristic on the gear only.
  assert.deepEqual(engine.evaluate(scoped.ref("gear")).keywords, [{ id: "deflect", value: 1 }]);
  assert.deepEqual(engine.evaluate(scoped.ref("other-gear")).keywords, []);
  assert.deepEqual(engine.evaluate(scoped.ref("enemy-gear")).keywords, []);
  assert.deepEqual(engine.evaluate(scoped.ref("curator")).keywords, []);
  assert.equal(keywordDefinitionsById.get("Deflect"), deflect);
  // 809.2: additional Deflect sources sum, so the granted value is additive.
  assert.equal(deflect.stacking, "sum");
});

test("rad-037-167 Watchful Curator: a gear's own Deflect adds up per CR 809.2", () => {
  const { engine, scoped } = grantTo({ gearKeywords: [{ id: "deflect", value: 1 }] });
  assert.deepEqual(engine.evaluate(scoped.ref("gear")).keywords, [{ id: "deflect", value: 2 }]);
});

test("rad-037-167 Watchful Curator: the grant expires with its declared this-turn duration when authored so", () => {
  // The card's grant is permanent (Pathun's "have" auras persist); a this-turn
  // grant through the same primitive registers an end-of-turn duration instead.
  const { scoped } = grantTo();
  assert.deepEqual(scoped.continuousEffects[0].duration, { type: "permanent" });
  const temporary = runAbilityBody([
    {
      id: "watchful-curator.temporary-grant",
      op: "continuous.grant-keyword",
      args: {
        keyword: { kind: "constant", value: "deflect" },
        value: { kind: "constant", value: 1 },
        duration: { kind: "constant", value: "end-of-turn" }
      },
      targets: [
        { id: GRANT_TARGET, filter: { type: "gear", zone: "board" }, min: 1, max: 1, selection: "one" }
      ]
    }
  ], scoped);
  assert.equal(temporary.results[0].result.status, "executed");
  const durations = scoped.continuousEffects.map(entry => entry.duration.type);
  assert.deepEqual(durations, ["permanent", "end-of-turn"]);
});

test("rad-037-167 Watchful Curator: the Deflect expansion the granted keyword feeds produces target.tax", () => {
  // The Deflect KeywordDef expands to target.tax. The remaining production gap
  // is wiring that expansion into target-plan options.tax and the payment chain.
  const [expansion] = deflect.expand({ value: 1, host: { canonicalCardId: CANONICAL } });
  assert.equal(expansion.effect.kind, "target.tax");
  assert.deepEqual(expansion.effect.value, { kind: "constant", value: 1 });
  assert.equal(grant.effect.kind, "continuous.grant-keyword");
});

test("rad-037-167 Watchful Curator: the production static binder registers the grant for the layer engine", () => {
  // createEngineStaticBinder is the production adapter used by
  // attachProgramLifecycle; it turns bindStatic calls into ContinuousEffectSpec
  // registrations on the chain's layer registry.
  const source = boardObject("curator", ["unit"], { might: 4 });
  const gear = { ...boardObject("gear", ["gear"]), ref: { id: "gear", zoneEntryId: 2 } };
  const enemyGear = { ...boardObject("enemy-gear", ["gear"], { owner: "B", controller: "B" }), ref: { id: "enemy-gear", zoneEntryId: 3 } };
  const registered = [];
  const engine = {
    layers: {
      addContinuous: (spec) => registered.push(spec),
      removeContinuous: () => {},
    },
  };
  const binder = createEngineStaticBinder(engine);
  binder.bindStatic(grant, source);
  assert.equal(registered.length, 1);
  const spec = registered[0];
  assert.equal(spec.layer, "ability");
  assert.deepEqual(spec.source, source.ref);
  assert.deepEqual(spec.filter, { type: "gear", controller: "A", zone: "board" });
  assert.equal(spec.effect.keyword, "deflect");
  assert.deepEqual(spec.effect.value, 1);
  const layerEngine = createLayerEngine(
    [source, gear, enemyGear],
    [{ effect: spec, duration: { type: "permanent" } }]
  );
  assert.deepEqual(layerEngine.evaluate(gear.ref).keywords, [{ id: "deflect", value: 1 }]);
  assert.deepEqual(layerEngine.evaluate(enemyGear.ref).keywords, []);
});

test.todo(
  "rad-037-167 Watchful Curator: selecting granted-Deflect gear must append its target.tax " +
    "automatically, require an any-domain Power payment per CR 809.1.c/809.1.c.1, and reject " +
    "Finalize/Resolve when the opponent cannot pay; the production tax adapter and any-domain Power payment chain are still missing."
);
