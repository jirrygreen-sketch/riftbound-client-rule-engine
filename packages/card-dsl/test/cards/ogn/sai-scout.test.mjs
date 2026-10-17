import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/sai-scout.js";
import Vision from "../../../../engine-core/dist/effects/keywords/Vision.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-e036ea2d851b80d8cb04068759c6d7e06f97fbc36723f415d5823f097f14cd29";
const [vision, permission] = program.abilities;

test("program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("identity: canonicalCardId, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Vision/);
  assert.match(program.judgeReason, /RIFT-259/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(
    program.sourceText,
    "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)\n" +
      "You may play me to an open battlefield."
  );
});

test("[Vision] is declared as a keyword ability only (817; expansion belongs to the keyword registry)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(vision, { kind: "keyword", keyword: "vision" });
  assert.equal(vision.value, undefined);
});

test("open-battlefield permission is a static play-location permission for self while in hand (355.2.b, 170.11.c)", () => {
  assert.equal(permission.kind, "static");
  assert.equal(permission.effect.kind, "play-location-permission");
  assert.equal(permission.effect.duration, "while-in-hand");
  assert.deepEqual(permission.effect.value, {
    kind: "constant",
    value: {
      zone: "battlefield",
      battlefield: { open: true },
      appliesTo: "self"
    }
  });
  assert.equal(permission.condition, undefined);
});

test("golden: the merged [Vision] expansion executes its Predict look with an ordered top-of-deck pick", () => {
  // 817.1.b: Vision is functionally "When this is played, [Predict]". The
  // keyword expansion (RIFT-82) is merged; its look + optional recycle execute
  // through the production adapter once the ordered top card is supplied (the
  // production lifecycle that supplies it is the remaining gap, see reason).
  const [expanded] = Vision.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expanded.trigger.at, "object-enters-board");
  const [look, recycle] = expanded.body;
  assert.equal(look.op, "effect.inspect");
  assert.equal(recycle.op, "effect.recycle");

  const kernel = world().deck(["top-card", "rest"]).build();
  const top = kernel.zoneSlice("A", "deck", "top", 1).map((object) => object.ref);
  kernel.setPicks("vision-top", top);
  // The expanded body's select request id is the primitive's stable
  // effect.inspect:select:<viewer>:<owner>:<zone>, appended to the look id
  // (engine-core/test/effects/keywords/Vision.test.mjs uses this exact form).
  kernel.setAnswers({ ["vision-look/" + encodeURIComponent("effect.inspect:select:A:A:deck")]: top });
  const outcome = resolveChainBody(expanded.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["vision-look.inspected"], 1);
  assert.equal(outcome.linkedValues["vision-recycle.recycledCount"], 1);
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["rest", "top-card"]);
});

test.todo(
  "execute [Vision]: the Predict step needs the ordered top-of-deck picks contract for effect.inspect " +
    "in the production lifecycle (its scope \"top\" negates without an upstream ordered picksSpecId) and the " +
    "object-enters-board trigger wiring (RIFT-257); the Vision expansion itself (RIFT-82) is merged and the " +
    "engine-core Vision suite executes it with a supplied ordered pick"
);
test.todo(
  "accept the open-battlefield play location at Make Relevant Choices once a consumer of " +
    "play-location-permission exists (RIFT-90/91)"
);
