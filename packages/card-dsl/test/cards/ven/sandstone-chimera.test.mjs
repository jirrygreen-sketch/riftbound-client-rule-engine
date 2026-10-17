// Template execution evidence: ../templates/static-645.test.mjs.
// This card remains judge-required; the template covers lifecycle registration
// while the Channel Phase consumer remains pending.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/sandstone-chimera.js";

const CANONICAL_ID =
  "card.hash-d0255097555a5da0f073d4ce07d5cc0f4bd79427917b9d1ea4b327b052d1cd20";
const SOURCE_TEXT =
  "While I'm at a battlefield, players only channel 1 rune at the start of their Channel Phase.";

const [restriction] = program.abilities;

test("ven-036-166 Sandstone Chimera: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-036-166 Sandstone Chimera: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /315\.3\.b/);
  assert.match(program.judgeReason, /431\.4\.a/);
  assert.match(program.judgeReason, /turn\/flow\.ts/);
  // The restrict primitive and the static binder are merged; the remaining gap
  // is the turn-flow consumer and the conditional-landing path.
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /statics\.ts/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-036-166 Sandstone Chimera: the card declares one static channel limit, not a fake channel instruction", () => {
  // 315.3.b / 431.4.a: the Channel Phase amount is turn structure, so the card
  // must express a restriction rather than a channel instruction of its own.
  assert.equal(program.abilities.length, 1);
  assert.equal(restriction.kind, "static");
  assert.deepEqual(restriction.effect, {
    kind: "continuous.restrict",
    operation: "channel-rune",
    scope: "turn-channel-phase",
    appliesTo: "all-players",
    limit: { kind: "constant", value: 1 }
  });
  // 363.2 / 363.2.a: "While …" conditions apply only while they hold; "I'm at a
  // battlefield" is the host's Location.
  assert.deepEqual(restriction.condition, {
    kind: "expression",
    value: {
      kind: "object-property",
      object: "self",
      property: "at-battlefield"
    }
  });
});

test("ven-036-166 Sandstone Chimera: the restriction applies to players, not only to its controller", () => {
  // The printed subject is "players", so the recorded scope must not be narrowed
  // to the controller or an opponent — 054.1 removes the option for everyone.
  assert.equal(restriction.effect.appliesTo, "all-players");
  assert.equal(restriction.effect.limit.value, 1);
  // No TargetSpec/pick is declared: "players" here is the turn-structure scope,
  // not a chosen object, so no target-trigger behaviour is introduced.
  assert.equal(restriction.targets, undefined);
  assert.equal(restriction.picks, undefined);
});

test.todo(
  "ven-036-166 Sandstone Chimera: clamp the Channel Phase amount to 1 (315.3.b / 431.4.a) — turn/flow.ts " +
    "computes the channel count from the rune deck alone and no merged turn-flow consumer reads a channel " +
    "restriction; the continuous.restrict primitive and the static binding are merged, but no layer " +
    "read exposes them to the turn flow"
);

test.todo(
  "ven-036-166 Sandstone Chimera: evaluate \"While I'm at a battlefield\" (363.2.a) — the location predicate " +
    "has no consumer on the turn-flow side; the static binding installs restriction rows through the merged static binder, " +
    "but nothing evaluates the conditional landing during the Channel Phase"
);
