import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/forgotten-monument.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { restrictions } from "../../../../engine-core/dist/layers/rules/query.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const [ability] = program.abilities;

test("sfd-209-221 Forgotten Monument: validates, is registered and keeps identity/source text", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(
    program.canonicalCardId,
    "card.hash-b6280b20779b152b78ff7c32ddd405d6d7c490bb00b2e8939b821030dffcab90"
  );
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /third turn/);
  assert.match(program.judgeReason, /this-battlefield/);
  assert.doesNotMatch(program.judgeReason, /RIFT-257|RIFT-259/);
  assert.equal(program.sourceText, "Players can't score here until their third turn.");
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("sfd-209-221 Forgotten Monument: static per-player scoring restriction on this battlefield", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.restrict");
  assert.equal(ability.effect.restriction, "score");
  assert.equal(ability.effect.appliesTo, "this-battlefield");
  assert.deepEqual(ability.effect.until, { perPlayerTurn: 3 });
  // Not a controller-scoped ability: the text names no controller (190.6.d does not apply).
  assert.equal(ability.condition, undefined);
  assert.equal(ability.effect.filter, undefined);
});

test("sfd-209-221 Forgotten Monument golden: the merged primitive registers a readable score restriction", () => {
  // The static ability declares "prohibit scoring"; the golden executes the
  // corresponding merged instruction shape so the registration and the rules
  // query are real evidence. The scoring flow not consulting the registry is
  // the judged gap, not the primitive.
  assert.equal(ability.effect.kind, "continuous.restrict");
  const effect = ability.effect;
  const body = [
    {
      id: "forgotten-monument.restrict",
      op: "continuous.restrict",
      args: {
        action: { kind: "constant", value: "score" },
        restriction: { kind: "constant", value: "forgotten-monument" },
        appliesTo: {
          kind: "constant",
          value: { object: "self" }
        }
      }
    }
  ];
  assert.equal(effect.restriction, "score");

  const kernel = world().build();
  const outcome = resolveChainBody(body, kernel);
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["forgotten-monument.restrict", "executed"]
  ]);
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "ability");
  assert.equal(registration.effect.effect.kind, "restriction");
  assert.deepEqual(registration.effect.effect.actions, ["score"]);
  assert.deepEqual(registration.duration, { type: "permanent" });

  // layers/rules/query reads the registration for the score action...
  const registry = new ContinuousEffectRegistry();
  registry.register(registration.effect, registration.duration, 1);
  assert.deepEqual(
    restrictions(registry, "score").map((entry) => ({ actions: entry.actions, name: entry.name })),
    [{ actions: ["score"], name: "forgotten-monument" }]
  );
  // ...and it does not leak into other actions.
  assert.deepEqual(restrictions(registry, "move"), []);
});

test("sfd-209-221 Forgotten Monument boundary: static binding needs a concrete battlefield identity", () => {
  const f = fixture({ cards: [{ id: "monument", cardId: program.canonicalCardId, types: ["battlefield"] }] });
  assert.throws(
    () => createEngineStaticBinder(f.engine).bindStatic(ability, f.kernel.getObject("monument")),
    /Unsupported static appliesTo/
  );
});

// The scoring flow does not consult the restriction registry, and card IR has
// no "this is that player's third turn" condition (condition.history is
// action/timing based).
test.todo(
  "sfd-209-221 Forgotten Monument: the scoring flow (scoring/scoring.ts) must consult the " +
    "continuous.restrict registry before a player scores (470.1/471) — no production caller " +
    "queries it today"
);
test.todo(
  "sfd-209-221 Forgotten Monument: per-player turn-count condition for 'until their third turn'"
);
