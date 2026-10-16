import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/yuumi-magical-cat.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { isTimingPointId } from "../../../../engine-core/dist/events/timing-points.js";

const CANONICAL_ID =
  "card.hash-aae7ffb0cf04d0753642ceccd3901394849fd519821df46ff303c0e450bc6e2d";
const SOURCE_TEXT =
  "When I attack or defend, give one of your other units here +3 :rb_might: and [Tank] this turn. " +
  "(It must be assigned combat damage first.)";

const [onAttack, onDefend] = program.abilities;
const [grantMight, grantTank] = onAttack.body;
const [otherUnitSpec] = grantMight.targets;
const OTHER_UNIT = "yuumi-magical-cat.other-unit-here";

test("unl-056-219 Yuumi, Magical Cat: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-056-219 Yuumi, Magical Cat: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /RIFT-120/);
});

test("unl-056-219 Yuumi, Magical Cat: 'attack or defend' becomes two triggers over the shared printed text (383.4.e.1/383.4.f.1)", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(onAttack.kind, "triggered");
  assert.equal(onAttack.trigger.at, "attack-declared");
  assert.equal(isTimingPointId("attack-declared"), true);
  assert.deepEqual(onAttack.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(onAttack.optional, false);

  assert.equal(onDefend.kind, "triggered");
  assert.equal(onDefend.trigger.at, "defense-declared");
  assert.equal(isTimingPointId("defense-declared"), true);
  assert.deepEqual(onDefend.trigger.filter, {
    event: "defense-declared",
    filter: { source: "self" }
  });
  assert.equal(onDefend.optional, false);

  // Both conditions carry the same printed instructions and the same shape.
  assert.deepEqual(
    onDefend.body.map(instruction => instruction.id),
    onAttack.body.map(instruction => instruction.id)
  );
  assert.deepEqual(onDefend.body[0].targets, onAttack.body[0].targets);
});

test("unl-056-219 Yuumi, Magical Cat: 'one of your other units here' is one target excluding the source (355.9.b/355.9.c/359.3.f.1)", () => {
  assert.deepEqual(otherUnitSpec, {
    id: OTHER_UNIT,
    filter: {
      type: "unit",
      zone: "board",
      controller: "controller",
      sameLocationAs: "source",
      exclude: "self"
    },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(grantMight.picks, undefined);
});

test("unl-056-219 Yuumi, Magical Cat: '+3 Might this turn' keeps the layers shape and never becomes a Buff (143.2.a, 475, 702)", () => {
  assert.equal(grantMight.id, "yuumi-magical-cat.grant-might");
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(grantMight.args.objects, {
    kind: "constant",
    value: { kind: "target", id: OTHER_UNIT }
  });
  // The Buff keyword action belongs to effect.buff / 702 counters; this card
  // never declares it for a Might change.
  assert.notEqual(grantMight.op, "effect.buff");
  assert.equal(grantMight.linkedTo, undefined);
});

test("unl-056-219 Yuumi, Magical Cat: 'and [Tank] this turn' keeps the duration-bounded keyword grant shape (801.3.a)", () => {
  assert.equal(grantTank.id, "yuumi-magical-cat.grant-tank");
  assert.equal(grantTank.op, "continuous.grant-keyword");
  assert.deepEqual(grantTank.args.keyword, { kind: "constant", value: "Tank" });
  assert.deepEqual(grantTank.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(grantTank.args.objects, {
    kind: "constant",
    value: { kind: "target", id: OTHER_UNIT }
  });
  assert.deepEqual(grantTank.targets, grantMight.targets);
  // The reminder in parentheses is the Tank rule text (135.2.d.1/d.3), not a
  // second instruction.
  assert.equal(onAttack.body.length, 2);
  assert.equal(grantTank.linkedTo, undefined);
});

test.todo(
  "unl-056-219 Yuumi, Magical Cat: apply '+3 :rb_might: this turn' in the arithmetic layer with an end-of-turn " +
    "duration and cleanup expiry (CR 143.2.a / 475 / 315.4) — no continuous.might instruction and no card-side " +
    "continuous-effect registration (RIFT-91)"
);

test.todo(
  "unl-056-219 Yuumi, Magical Cat: grant [Tank] until end of turn (CR 801.3.a.2/a.3) — no continuous.grant-keyword " +
    "instruction, no layer consumer for a static grant, and no combat damage-assignment consumer for Tank (RIFT-91)"
);

test.todo(
  "unl-056-219 Yuumi, Magical Cat: emit attack-declared / defense-declared from combat and register these two " +
    "triggers (CR 383.4.e.2/f.2, 466.2.c) — neither timing point is emitted anywhere and no subscriber registers " +
    "card-program triggers (RIFT-33, RIFT-120)"
);
