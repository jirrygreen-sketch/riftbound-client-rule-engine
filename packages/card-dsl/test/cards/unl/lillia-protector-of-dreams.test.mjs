import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/lillia-protector-of-dreams.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { isTimingPointId } from "../../../../engine-core/dist/events/timing-points.js";

const CANONICAL_ID =
  "card.hash-6e0aa33991db4d3499a6f694e8bef73ea18c9f5a92c1cff628ee2afc84a34321";
const SOURCE_TEXT =
  "When you play a token unit, give me +1 :rb_might: this turn.\n" +
  "Your token units have [Tank]. (They must be assigned combat damage first.)";

const [tokenPlayed, tokenTank] = program.abilities;
const [grantMight] = tokenPlayed.body;
const [selfSpec] = grantMight.targets;

test("unl-058-219 Lillia, Protector of Dreams: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-058-219 Lillia, Protector of Dreams: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /RIFT-120/);
});

test("unl-058-219 Lillia, Protector of Dreams: 'When you play a token unit' is not a Play Effect (383.4.a.4)", () => {
  assert.equal(tokenPlayed.kind, "triggered");
  assert.equal(tokenPlayed.trigger.at, "card-played");
  assert.equal(isTimingPointId("card-played"), true);
  // 383.4.a.4: the ability triggers on ANOTHER object being played, so it is not
  // a Play Effect; the owned token unit is the event object.
  assert.deepEqual(tokenPlayed.trigger.filter, {
    event: "card-played",
    object: { type: "token", controller: "self" }
  });
  assert.equal(tokenPlayed.trigger.condition, undefined);
  assert.equal(tokenPlayed.trigger.once, undefined);
  assert.equal(tokenPlayed.optional, false);
});

test("unl-058-219 Lillia, Protector of Dreams: 'give me +1 Might this turn' keeps the layers shape and never becomes a Buff", () => {
  assert.equal(grantMight.id, "lillia-protector-of-dreams.grant-might");
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "end-of-turn" });
  // 053.1 / 355.9.c: "me" is the ability host itself.
  assert.deepEqual(selfSpec, {
    id: "lillia-protector-of-dreams.self",
    filter: { type: "unit", zone: "board", object: "self" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.notEqual(grantMight.op, "effect.buff");
  assert.equal(grantMight.linkedTo, undefined);
  assert.equal(grantMight.condition, undefined);
});

test("unl-058-219 Lillia, Protector of Dreams: 'Your token units have [Tank]' is a static grant scoped to your token units (801.3.a)", () => {
  assert.equal(tokenTank.kind, "static");
  assert.equal(tokenTank.effect.kind, "continuous.grant-keyword");
  assert.equal(tokenTank.effect.keyword, "Tank");
  assert.deepEqual(tokenTank.effect.filter, {
    // 185.1/185.2 + 355.9.a.1: token units are objects on the board whose token
    // category the merged filter vocabulary matches.
    type: "token",
    controller: "controller",
    zone: "board"
  });
  assert.equal(tokenTank.condition, undefined);
  // The reminder in parentheses is Tank's rule text (135.2.d.1/d.3).
  assert.equal(program.abilities.length, 2);
});

test.todo(
  "unl-058-219 Lillia, Protector of Dreams: apply '+1 :rb_might: this turn' in the arithmetic layer with an " +
    "end-of-turn duration and cleanup expiry (CR 143.2.a / 475 / 315.4) — no continuous.might instruction and no " +
    "card-side continuous-effect registration (RIFT-91)"
);

test.todo(
  "unl-058-219 Lillia, Protector of Dreams: grant [Tank] to your token units (CR 801.3.a, 364.1/364.2) — no " +
    "continuous.grant-keyword instruction, no layer consumer for a static grant, and no combat " +
    "damage-assignment consumer for Tank (RIFT-91)"
);

test.todo(
  "unl-058-219 Lillia, Protector of Dreams: register the card-played trigger for another played token unit " +
    "(CR 383.4.a.4) — no subscriber turns a card program's triggered ability into a TriggerRegistration (RIFT-120)"
);
