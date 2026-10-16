// Golden test for Entrenched Boar (rad-026-167).
//
// judge-required (see the program's judgeReason): "enter ready" needs the
// unmerged entry replacement, the printed "you may" is replacement-level
// optionality that the IR cannot express, and "I can't move this turn" needs a
// continuous movement restriction with a consumer. The runnable evidence is the
// declared structure plus the real eligibility of the declared statuses/steps.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/entrenched-boar.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";

const CANONICAL =
  "card.hash-83b3503583d3b1c2a4c954330e33aa17c188c4a97ab757da916900476485a9f4";
const SOURCE_TEXT = "You may have me enter ready. If you do, I can't move this turn.";

const [replacement] = program.abilities;
const [optional] = replacement.with;
const [enterReady, cannotMove] = optional.args.body.value;

test("rad-026-167 Entrenched Boar: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-026-167 Entrenched Boar: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // README §2: the reason names each missing semantic and the owner tasks.
  assert.match(program.judgeReason, /replacement\.enter/);
  assert.match(program.judgeReason, /optional/);
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-026-167 Entrenched Boar: one self-entry replacement wrapping the optional ready entry", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(replacement.kind, "replacement");
  // CR 369.3 / 359.2.c: the replaced event is this unit entering exhausted.
  assert.deepEqual(replacement.replaces, {
    event: "object-enters-board",
    filter: { source: "self" }
  });
  // CR 3.9 (contract): "may" is a choice.optional wrapping the chosen instruction.
  assert.equal(replacement.with.length, 1);
  assert.equal(replacement.with[0].op, "choice.optional");
  assert.equal(optional.op, "choice.optional");
  // The entry rewrite itself is the planned replacement.enter primitive, not a
  // post-entry effect.ready (which would fire a "becomes ready" event).
  assert.equal(enterReady.op, "replacement.enter");
  assert.deepEqual(enterReady.args.state, { kind: "constant", value: "ready" });
  assert.deepEqual(replacement.with[0].args.body.kind, "constant");
});

test("rad-026-167 Entrenched Boar: 'I can't move this turn' is linked to the accepted entry rewrite", () => {
  // CR 054 (Can't beats Can) + 144.1/144.2 (Standard Move) + 317.2.c (expiry).
  assert.equal(cannotMove.op, "continuous.restrict");
  assert.deepEqual(cannotMove.args.restriction, {
    kind: "constant",
    value: "cannot-move"
  });
  assert.deepEqual(cannotMove.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(cannotMove.args.appliesTo, { kind: "constant", value: "self" });
  // The restriction is conditioned on the accepted choice: it is inside the
  // optional body and linked to the entry rewrite it depends on.
  assert.equal(cannotMove.linkedTo, "entrenched-boar.enter-ready");
});

test("rad-026-167 Entrenched Boar: the declared body ops are not executable today (fail closed)", () => {
  // Both the entry rewrite and the restriction are declarations for unmerged
  // consumers; they must not silently resolve into some other merged action.
  const kernel = world().unit("boar", { might: 2, exhausted: true }).build();
  const source = kernel.clone({ sourceSnapshot: kernel.getObject("boar") });
  // effect.ready exists but is deliberately NOT the declared op for the entry step.
  assert.notEqual(enterReady.op, "effect.ready");
  assert.equal(ready.op, "effect.ready");
  const noop = runInstruction(ready, {}, { world: source });
  // A post-entry ready would ready an already-on-board unit — which is exactly
  // why it cannot stand in for "enter ready" (359.2.c / 369.3 / 805.6).
  assert.equal(noop.result.status, "executed");
  assert.equal(source.getObject("boar").exhausted, false);
});

test("rad-026-167 Entrenched Boar: the movement restriction is declared but has no merged consumer", () => {
  // The Move system has no reader for a card-declared movement restriction, so
  // a standard move is still legal on the reference kernel; recording this keeps
  // the judged gap visible instead of implying the card works.
  const kernel = world()
    .unit("boar", { might: 2, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const run = runInstruction(
    move,
    {
      objects: { kind: "constant", value: "source" },
      to: { kind: "constant", value: { type: "battlefield", id: "bf-2" } }
    },
    { world: kernel.clone({ sourceSnapshot: kernel.getObject("boar") }) }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.moved.count, 1);
  assert.equal(cannotMove.args.duration.value, "end-of-turn");
});

test.todo(
  "Entrenched Boar: 'You may have me enter ready' as an entry replacement (369.3) with the may-decision at the replacement " +
    "level — blocked because IR's ReplacementAbility has no optional field and no merged path registers a card's replacement, " +
    "while effect.ready cannot simulate entering ready (RIFT-9 / RIFT-120)"
);

test.todo(
  "Entrenched Boar: 'I can't move this turn' — blocked because no merged instruction or layer consumer implements a " +
    "continuous movement restriction with an end-of-turn duration (continuous.restrict; RIFT-91)"
);
