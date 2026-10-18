// Golden test for Forecaster (sfd-065-221).
//
// Scenario execution evidence: ../templates/static-642.test.mjs.
// This file keeps the validation/identity checks and the key structural
// assertions; the real execution path for this card lives in that template row.
//
// The static Vision grant executes through the production static binder and
// continuous.grant-keyword primitive. The remaining gap is the semantic
// expansion of a runtime-gained Vision.
import test from "node:test";
import assert from "node:assert/strict";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/forecaster.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL = "card.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40";
const SOURCE_TEXT =
  "Your Mechs have [Vision]. (When you play us, look at the top card of your " +
  "Main Deck. You may recycle it.)";

const [grant] = program.abilities;

const registrations = (kernel) =>
  kernel.continuousEffects.map((entry) => ({ effect: entry.effect, duration: entry.duration, timestamp: 1 }));

test("sfd-065-221 Forecaster: program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-065-221 Forecaster: judgeReason names the current dynamic Vision gap", () => {
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /817\.1\.b/);
  assert.match(program.judgeReason, /运行时获得的 Vision/);
  assert.match(program.judgeReason, /KeywordGrantLayerEngine/);
  assert.match(program.judgeReason, /triggered Predict/);
  assert.match(program.judgeReason, /production lifecycle/);
  assert.doesNotMatch(program.judgeReason, /RIFT-257|RIFT-258|RIFT-83/);
  assert.equal(keywordDefinitionsById.has("Vision"), true);
  assert.equal(keywordDefinitionsById.get("Vision").stacking, "separate");
});

test("sfd-065-221 Forecaster: static ability grants Vision to friendly Mech units", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(grant.kind, "static");
  assert.equal(grant.effect.kind, "continuous.grant-keyword");
  assert.equal(grant.effect.keyword, "Vision");
  assert.deepEqual(grant.effect.filter, {
    zone: "board",
    controller: "controller",
    tag: "Mech",
    type: "unit"
  });
  assert.equal(grant.condition, undefined);
});

test("sfd-065-221 Forecaster golden: the grant registers Vision only on friendly Mech units", () => {
  const base = world()
    .unit("host", { types: ["gear"], zone: "board", owner: "A", controller: "A", might: null })
    .unit("mech-ally", { owner: "A", controller: "A", tags: ["Mech"] })
    .unit("plain-ally", { owner: "A", controller: "A" })
    .unit("enemy-mech", { owner: "B", controller: "B", tags: ["Mech"] })
    .build();
  // The production binder translates the card's filter vocabulary (tag → tags,
  // controller normalization); the chain query then resolves self/opponent
  // against the ability controller. Bind the production matcher and that
  // normalization so the card's own filter shape executes unchanged.
  const declaredFilter = translateObjectFilter(grant.effect.filter);
  assert.deepEqual(declaredFilter, {
    zone: "board",
    controller: "self",
    tags: ["Mech"],
    type: "unit"
  });
  const query = (filter) =>
    base.objects.filter((object) =>
      matchesObjectFilter(
        Object.fromEntries(
          Object.entries(filter).map(([key, value]) => [
            key,
            (key === "controller" || key === "owner") && value === "self" ? "A" : value
          ])
        ),
        object
      )
    );
  const kernel = bindResolveContext(base, {
    source: base.getObject("host"),
    sourceSnapshot: base.getObject("host"),
    query
  });

  const body = [
    {
      id: "forecaster.grant-vision",
      op: "continuous.grant-keyword",
      args: {
        keyword: { kind: "constant", value: grant.effect.keyword },
        objects: {
          kind: "constant",
          value: { kind: "query", filter: declaredFilter }
        }
      }
    }
  ];
  const outcome = resolveChainBody(body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(base.continuousEffects.length, 1);
  const [registration] = base.continuousEffects;
  assert.equal(registration.effect.layer, "ability");
  assert.equal(registration.effect.effect.keyword, "Vision");
  assert.deepEqual(registration.duration, { type: "permanent" });

  const layers = createLayerEngine(base.objects, registrations(base));
  assert.deepEqual(layers.evaluate(base.ref("mech-ally")).keywords.map((keyword) => keyword.id), ["Vision"]);
  assert.deepEqual(layers.evaluate(base.ref("plain-ally")).keywords, []);
  assert.deepEqual(layers.evaluate(base.ref("enemy-mech")).keywords, []);
});

test("sfd-065-221 Forecaster golden: no friendly Mech makes the grant a skipped negation", () => {
  const base = world()
    .unit("host", { types: ["gear"], zone: "board", owner: "A", controller: "A", might: null })
    .unit("plain-ally", { owner: "A", controller: "A" })
    .build();
  const query = (filter) =>
    base.objects.filter((object) =>
      matchesObjectFilter(
        Object.fromEntries(
          Object.entries(filter).map(([key, value]) => [
            key,
            (key === "controller" || key === "owner") && value === "self" ? "A" : value
          ])
        ),
        object
      )
    );
  const kernel = bindResolveContext(base, {
    source: base.getObject("host"),
    sourceSnapshot: base.getObject("host"),
    query
  });
  const outcome = resolveChainBody(
    [
      {
        id: "forecaster.grant-vision",
        op: "continuous.grant-keyword",
        args: {
          keyword: { kind: "constant", value: "Vision" },
          objects: {
            kind: "constant",
            value: { kind: "query", filter: translateObjectFilter(grant.effect.filter) }
          }
        }
      }
    ],
    kernel
  );
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(base.continuousEffects.length, 0);
});

test("sfd-065-221 Forecaster golden: the production static binder installs the friendly-Mech Vision aura", () => {
  const f = fixture({
    cards: [
      { id: "forecaster", cardId: CANONICAL, types: ["unit"], tags: ["Mech"] },
      { id: "friendly-mech", types: ["unit"], tags: ["Mech"] },
      { id: "enemy-mech", types: ["unit"], tags: ["Mech"], owner: "B", controller: "B" }
    ]
  });
  for (const id of ["forecaster", "friendly-mech", "enemy-mech"]) {
    f.engine.commit({
      type: "move-zone",
      object: f.kernel.ref(id),
      to: "battlefield",
      location: { type: "battlefield", id: "battlefield-1" }
    });
  }
  f.engine.advance();
  const source = f.kernel.getObject("forecaster");
  const handle = createEngineStaticBinder(f.engine).bindStatic(grant, source);
  f.engine.layers.setObjects(f.kernel.objects);
  assert.deepEqual(f.engine.layers.evaluate(f.kernel.ref("friendly-mech")).keywords, [
    { id: "Vision", value: undefined }
  ]);
  assert.deepEqual(f.engine.layers.evaluate(f.kernel.ref("enemy-mech")).keywords, []);
  handle.unbind();
  assert.deepEqual(f.engine.layers.evaluate(f.kernel.ref("friendly-mech")).keywords, []);
});

test.todo(
  "sfd-065-221 Forecaster: expand a runtime-gained Vision per instance into its 817.1.b Predict " +
    "trigger with a real controller and ordered deck-top binding; the merged re-expander is static-only " +
    "and the production lifecycle does not register this dynamic ability"
);
