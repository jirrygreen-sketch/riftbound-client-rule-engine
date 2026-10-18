// RIFT-703 execution evidence for the printed play procedure lives in
// test/cards/templates/play-703.test.mjs (parameter row keyed by this
// canonicalCardId). The program stays judge-required: the printed
// not-before-own-turn requirement still has no adapter and no per-player turn
// ordinal exists, which is pinned there against the real adapter. Every
// assertion below is retained.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/ol-poro.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-2ffb19822a72dc6ca4fc7111ad103487e5e4a120251c9b158b1064e31aa11748";
const SOURCE_TEXT = "I can't be played on your first, second, or third turns.";

const [play] = program.abilities;
const [requirement] = play.requirements;

test("ven-029-166 Ol' Poro: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-029-166 Ol' Poro: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /第 N 回合|turn/);
  assert.match(program.judgeReason, /Requirement|requirements/);
  assert.match(program.judgeReason, /forgotten-monument/);
});

test("ven-029-166 Ol' Poro: the printed prohibition is one PlayAbility with an empty body", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  // The printing carries no instruction at all: the whole line is a play
  // legality requirement (420.1/420.2.a with 054/054.1).
  assert.deepEqual(play.body, []);
  assert.equal(play.cost, undefined);
  assert.equal(play.restriction, undefined);
});

test("ven-029-166 Ol' Poro: the prohibition is recorded as a Finalize requirement", () => {
  // 349 / 356 / 357 / 358.2: the legality check happens in Finalize; contract 3.4
  // keeps Requirement (must hold to play) separate from Restriction.
  assert.equal(play.requirements.length, 1);
  assert.equal(requirement.kind, "not-before-own-turn");
  // "your first, second, or third turns" is per player, so the card records the
  // first legal turn rather than turning the clause into a always-true gate.
  assert.deepEqual(requirement.value, { kind: "constant", value: 4 });
  assert.equal(requirement.condition, undefined);
});

test("ven-029-166 Ol' Poro: the requirement is descriptive, not an invented satisfied gate", () => {
  // Nothing in the frozen Condition vocabulary or HistoryQuery expresses "this
  // player's Nth turn", so the requirement stays descriptive: it is neither a
  // `never` that would forbid the card forever nor an `always` that would drop
  // the printed restriction.
  assert.notEqual(requirement.kind, "always");
  assert.notEqual(requirement.kind, "never");
  assert.equal(requirement.condition, undefined);
  assert.notEqual(requirement.value.value, 1);
});

test.todo(
  "ven-029-166 Ol' Poro: 'your first, second, or third turns' needs a per-player turn-ordinal " +
    "predicate — Condition only has always/never/compare/all/any/not/expression and HistoryQuery " +
    "counts actions/timing points, not turn numbers (same gap as sfd/forgotten-monument)"
);

test.todo(
  "ven-029-166 Ol' Poro: the Finalize legality check must consume a card program's play " +
    "not-before-own-turn Requirement through translateLegalityCondition and the per-player turn ordinal; " +
    "standard play requirements/restrictions are already forwarded"
);

// RIFT-733: the refreshed gaps, pinned against the real production seam.
test("ven-029-166 Ol' Poro: the per-player turn ordinal has no engine-side evaluator yet", () => {
  // RIFT-711 added player-turn-count / turn-number to the card-dsl Expr
  // vocabulary (that shape validates), but effects/interpreter/expr.ts still
  // dispatches only the original kinds, so a condition using the new
  // expression throws instead of resolving (485.7-style per-player windows).
  const expression = { kind: "player-turn-count" };
  const condition = {
    kind: "compare",
    left: expression,
    operator: "gte",
    right: { kind: "constant", value: 4 }
  };
  const kernel = world().player("A").player("B").build();
  assert.throws(
    () => evaluateCondition(condition, {
      context: kernel, linked: () => undefined, canLookBack: () => false, isIgnored: () => false
    }),
    /Unsupported expression: player-turn-count/
  );
  // The reference kernel fails closed to false for the same condition.
  assert.equal(kernel.test(condition), false);
});

test("ven-029-166 Ol' Poro: the printed requirement still fails closed at the production play seam", () => {
  const binding = createProgramBinding({ cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }] });
  const kernel = world().object("subject", {
    cardId: CANONICAL_ID, types: ["unit"], zone: "hand", energy: 2, power: null, might: 4
  }).build();
  const source = kernel.getObject("subject");
  assert.throws(
    () => binding.describePlay({ type: "play", object: source.ref, player: "A" }, source),
    error => error.code === "judge-required" && /not-before-own-turn needs a rules adapter/.test(error.message)
  );
});
