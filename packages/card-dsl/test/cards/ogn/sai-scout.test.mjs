import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/sai-scout.js";

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
  assert.match(program.judgeReason, /play-location-permission|打出位置/);
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

test.todo(
  "execute [Vision]: the Predict step needs the ordered top-of-deck picks contract for effect.inspect " +
    "(its scope \"top\" currently negates without an upstream ordered picksSpecId; RIFT-64), plus the " +
    "object-enters-board trigger wiring"
);
test.todo(
  "accept the open-battlefield play location at Make Relevant Choices once a consumer of " +
    "play-location-permission exists (RIFT-90/91)"
);
