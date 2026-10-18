// Forgotten Monument single-card golden: validation, identity, the key IR structure of
// Forgotten Monument, and the merged restriction-query half. The whole-card
// execution evidence (its own scenario through the generic card harness plus the
// measured outcome of binding its own static ability with the production binder)
// lives in `test/cards/templates/sfd-667.test.mjs`-style template neighbours:
// `test/cards/templates/static-667.test.mjs`.
//
// The card stays judge-required: the production static binder now really binds
// the self anchor to this battlefield's zone entry and the restriction query
// returns it, but scoring/scoring.ts never consults the registry, and the
// per-player "their third turn" window has no slot on the restriction. Nothing
// here approximates it.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/forgotten-monument.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { restrictions } from "../../../../engine-core/dist/layers/rules/query.js";
import { bindStaticAbility, createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL = "card.hash-b6280b20779b152b78ff7c32ddd405d6d7c490bb00b2e8939b821030dffcab90";
const SOURCE_TEXT = "Players can't score here until their third turn.";
const [ability] = program.abilities;

test("sfd-209-221 Forgotten Monument: program validates, is registered and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(CANONICAL), program);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-209-221 Forgotten Monument: static per-player scoring restriction on this battlefield", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  // 470.1 / 471.1: the prohibition is on the Scoring process at this location.
  assert.equal(ability.effect.kind, "continuous.restrict");
  // 470.1/471: the prohibition binds the Scoring action itself.
  assert.deepEqual(ability.effect.actions, ["score"]);
  assert.equal(ability.effect.restriction, "forgotten-monument");
  // 470.1/471: "here" is this battlefield. The ability host is that
  // Battlefield object, so the merged source-relative anchor is used.
  assert.equal(ability.effect.appliesTo, "self");
  assert.deepEqual(ability.effect.until, { perPlayerTurn: 3 });
  // Not a controller-scoped ability: the text names no controller.
  assert.equal(ability.condition, undefined);
  assert.equal(ability.effect.filter, undefined);
});

test("sfd-209-221 Forgotten Monument component: the merged restriction query is real", () => {
  // The primitive and the query are merged; the judged gap is the battlefield
  // identity plus the scoring consumer, not the registration vocabulary.
  const body = [{
    id: "forgotten-monument.restrict",
    op: "continuous.restrict",
    args: {
      action: { kind: "constant", value: "score" },
      restriction: { kind: "constant", value: "forgotten-monument" },
      appliesTo: { kind: "constant", value: { object: "self" } }
    }
  }];
  const kernel = world().unit("monument").build();
  const outcome = resolveChainBody(body, kernel);
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["forgotten-monument.restrict", "executed"]
  ]);
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "ability");
  assert.equal(registration.effect.effect.kind, "restriction");
  assert.deepEqual(registration.effect.effect.actions, ["score"]);
  assert.deepEqual(registration.duration, { type: "permanent" });
  const registry = new ContinuousEffectRegistry();
  registry.register(registration.effect, registration.duration, 1);
  assert.deepEqual(
    restrictions(registry, "score").map(entry => ({ actions: entry.actions, name: entry.name })),
    [{ actions: ["score"], name: "forgotten-monument" }]
  );
  // It does not leak into other actions.
  assert.deepEqual(restrictions(registry, "move"), []);
});

test("sfd-209-221 Forgotten Monument: judgeReason names the measured gaps", () => {
  // Re-probed 2026-10-18: the binder and query are real, but no production
  // caller consumes the registry and the window has no slot.
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /scoring\/scoring\.ts/);
  assert.match(program.judgeReason, /player-turn-count/);
  assert.match(program.judgeReason, /third turn/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
});

test("sfd-209-221 Forgotten Monument: the production binder really anchors the restriction to this battlefield", () => {
  // 470.1/471: "this battlefield" is the ability host. The merged binder
  // resolves the source-relative anchor to the exact zone entry, so the
  // restriction query can return it for a real Scoring lookup. What is still
  // missing is the scoring consumer (and the printed window).
  // fixture()'s cards land in hand, so build the Battlefield host on the Board.
  const f = fixture({ cards: [] });
  f.kernel.addObject(
    {
      ref: { id: "monument", zoneEntryId: 1 },
      cardId: CANONICAL,
      name: "Forgotten Monument",
      types: ["battlefield"],
      tags: [],
      keywords: [],
      owner: "A",
      controller: "A",
      zone: "board",
      location: { type: "battlefield", id: "bf-1" },
      might: null,
      energy: null,
      power: null,
      exhausted: false,
      damage: 0,
      stunned: false,
      buffs: 0,
      attachedTo: null,
      faceDown: false,
      isToken: false
    },
    "board"
  );
  const source = f.kernel.getObject("monument");
  const handle = bindStaticAbility(createEngineStaticBinder(f.engine), ability, source);

  const [registration] = f.engine.layers.registry.list();
  assert.equal(registration.effect.effect.kind, "restriction");
  assert.deepEqual(registration.effect.filter, {
    objectId: "monument",
    zone: "board",
    zoneEntryId: source.ref.zoneEntryId
  });
  assert.deepEqual(
    restrictions(f.engine.layers.registry, "score", source.ref, source, source.controller)
      .map(entry => [entry.actions, entry.name]),
    [[["score"], "forgotten-monument"]]
  );
  // It really is scoped to Scoring: another action is unaffected.
  assert.deepEqual(
    restrictions(f.engine.layers.registry, "move", source.ref, source, source.controller),
    []
  );
  // It really is scoped to this battlefield: another battlefield is unaffected.
  assert.deepEqual(
    restrictions(
      f.engine.layers.registry,
      "score",
      { id: "other", zoneEntryId: 1 },
      { ...source, ref: { id: "other", zoneEntryId: 1 } },
      source.controller
    ),
    []
  );
  handle.unbind();
  assert.deepEqual(f.engine.layers.registry.list(), []);
});

test.todo(
  "sfd-209-221 Forgotten Monument: the scoring flow (scoring/scoring.ts) must consult the continuous.restrict " +
    "registry before a player scores here (CR 470.1 / 471) - no production caller queries it today"
);
test.todo(
  "sfd-209-221 Forgotten Monument: per-player turn-count condition for 'until their third turn' - card IR has " +
    "no turn-ordinal vocabulary (condition.history counts actions/timing points only)"
);
