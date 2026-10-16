import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/scrapyard-champion.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-813e3cdd87747fd72b9679e715bca8af859194bf01e8160ea2b0bc3334d66ec7";
const [legion, triggered] = program.abilities;
const DISCARD = "scrapyard-champion.discard/effect.discard%3AA";

test("scrapyard-champion: passes validateCardProgram and is indexed by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardProgramsById.get(CARD_ID), program);
});

test("scrapyard-champion: identity, ruleset, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /812\.1\.c/);
  assert.match(program.judgeReason, /HistoryQuery/);
  assert.match(program.judgeReason, /RIFT-82/);
  assert.equal(
    program.sourceText,
    "[Legion] — When you play me, discard 2, then draw 2. (Get the effect if you've played another card this turn.)"
  );
});

test("scrapyard-champion: Legion keyword plus a mandatory card-played trigger gated on another card (812.1.c, 420.4.a)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(legion, { kind: "keyword", keyword: "legion" });
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    filter: { source: "self", player: "controller" }
  });
  assert.deepEqual(triggered.trigger.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "cards-finalized-this-turn",
      filter: { player: "controller", exclude: "self" }
    },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
  assert.equal(triggered.optional, false);
});

test("scrapyard-champion: body is discard 2 then draw 2, in that order, without shared conditions", () => {
  assert.deepEqual(triggered.body.map(instruction => instruction.id), [
    "scrapyard-champion.discard",
    "scrapyard-champion.draw"
  ]);
  const [discard, draw] = triggered.body;
  assert.equal(discard.op, "effect.discard");
  assert.deepEqual(discard.args, { amount: { kind: "constant", value: 2 } });
  assert.equal(discard.condition, undefined);
  assert.equal(draw.op, "effect.draw");
  assert.deepEqual(draw.args, { amount: { kind: "constant", value: 2 } });
  assert.equal(draw.condition, undefined);
  // "then" is ordering, not a data dependency: linking would suppress the draw
  // when the discard is negated (359.3.e.14.a), which the card text does not say.
  assert.equal(discard.linkedTo, undefined);
  assert.equal(draw.linkedTo, undefined);
});

test("scrapyard-champion: discarding 2 then drawing 2 runs the real primitives in order", () => {
  const kernel = world()
    .hand("first", { owner: "A" })
    .hand("second", { owner: "A" })
    .hand("third", { owner: "A" })
    .deck(["top", "next", "last"], { owner: "A" })
    .build();
  kernel.setAnswers({ [DISCARD]: [kernel.ref("first"), kernel.ref("second")] });
  const outcome = resolveChainBody(triggered.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["scrapyard-champion.discard", "executed"],
    ["scrapyard-champion.draw", "executed"]
  ]);
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["first", "second"]);
  // The reference kernel keeps zone order: "third" was never discarded and the
  // two drawn top cards follow it in hand.
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["third", "top", "next"]);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["last"]);
  // The kernel emits one event per discard action and one aggregated draw event
  // for the multi-card draw; the per-instruction linked values carry the counts.
  assert.deepEqual(outcome.events.map(event => event.action), ["discard", "discard", "draw"]);
  assert.equal(outcome.results[0].result.linkedValues.discarded.count, 2);
  assert.equal(outcome.results[1].result.linkedValues.drawn, 2);
});

test("scrapyard-champion: a short hand still draws 2 because the clauses are independent (359.3.e.11/14)", () => {
  const kernel = world()
    .hand("only", { owner: "A" })
    .deck(["top", "next"], { owner: "A" })
    .build();
  const outcome = resolveChainBody(triggered.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status, result.result.reason ?? null]), [
    ["scrapyard-champion.discard", "negated", "impossible"],
    ["scrapyard-champion.draw", "executed", null]
  ]);
  // "as much as possible": the one available card was still discarded (423.4).
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["only"]);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top", "next"]);
});

test("scrapyard-champion: swallowing the discard's negated status would hide real shortfalls", () => {
  const kernel = world().deck(["top", "next"], { owner: "A" }).build();
  const outcome = resolveChainBody(triggered.body, kernel);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "impossible");
  assert.equal(outcome.results[1].result.status, "executed");
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top", "next"]);
});

test.todo(
  "scrapyard-champion: the Legion gate needs the history query's card-exclusion dimension (812.1.c; contract 3.8 " +
    "exclude/objectFilter) before the trigger can be honestly evaluated"
);
test.todo(
  "scrapyard-champion: Legion expansion (RIFT-82) and the trigger -> chain wiring for card programs (RIFT-120) are unmerged"
);
