import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/poro-herder.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";

const CANONICAL =
  "card.hash-d30257c95bd0d16256944f4942f276da6f4e29317a22692f8f2bd04d8b0b5212";
const SOURCE_TEXT =
  "When you play me, if you control a Poro, buff me and draw 1. (If I don't have a buff, I get a +1 :rb_might: buff.)";

const triggered = program.abilities[0];
const [buffInstruction, drawInstruction] = triggered.body;

/**
 * Run the card's real body against the reference kernel through the merged
 * production body adapter (chain/interpreter-adapter.ts), which keeps the
 * card's Expr arguments intact for Expr-typed primitives such as effect.draw.
 */
function runBody({ buffs = 0, deck = ["deck-1", "deck-2"] } = {}) {
  const base = world()
    .unit("poro-herder", { owner: "A", might: 3, buffs })
    .deck(deck, { owner: "A" })
    .build();
  // The ability host and the ability source are the same object here: the Play
  // Effect belongs to the unit that just entered the board. The reference
  // kernel's source snapshot is what the interpreter binds the symbolic "self"
  // selector to, so point it at this unit (the production chain does the same
  // when it builds the trigger context from the triggering source).
  const kernel = base.clone({
    source: base.ref("poro-herder"),
    sourceSnapshot: base.getObject("poro-herder")
  });
  kernel.setTargets("poro-herder.me", [kernel.ref("poro-herder")]);
  const outcome = resolveChainBody(triggered.body, kernel);
  return { kernel, outcome };
}

test("ogn-061-298 Poro Herder: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
});

test("ogn-061-298 Poro Herder: identity, ruleset, status, judgeReason and source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /383\.2\.a\.1/);
  assert.match(program.judgeReason, /testTrigger/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /controller/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-061-298 Poro Herder: the trigger spec uses the merged filter spellings", () => {
  // The engine validator rejects the older { filter: { role: "self" } }
  // spelling; the played card identifies itself through its canonical id.
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    object: { canonicalCardId: CANONICAL }
  });
  const validated = validateTriggerSpec(triggered.trigger);
  assert.equal(validated.ok, true, JSON.stringify(validated.ok ? [] : validated.issues));
  // The condition stays on the TriggerSpec: 383.2.a.1 checks it before the
  // ability goes on the chain.
  assert.equal(triggered.trigger.condition.kind, "compare");
});

test("ogn-061-298 Poro Herder: the Poro condition belongs to the trigger condition (CR 383.2.a.1)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.equal(triggered.optional, false);

  // "if you control a Poro" is an additional conditional statement immediately
  // after the trigger condition, so it gates the ability before it is placed on
  // the chain (383.2.a.1) rather than an instruction-level condition.
  const condition = triggered.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });
  assert.equal(condition.left.kind, "count");
  assert.deepEqual(condition.left.filter, {
    type: "unit",
    tag: "Poro",
    controller: "self",
    zone: "board"
  });
  assert.equal(buffInstruction.condition, undefined);
  assert.equal(drawInstruction.condition, undefined);
});

test("ogn-061-298 Poro Herder: buff me targets the host through the self selector", () => {
  assert.equal(triggered.body.length, 2);
  assert.equal(buffInstruction.id, "poro-herder.buff-me");
  assert.equal(buffInstruction.op, "effect.buff");
  assert.deepEqual(buffInstruction.args, {
    mode: { kind: "constant", value: "buff" },
    target: { kind: "constant", value: "poro-herder.me" }
  });
  assert.deepEqual(buffInstruction.targets, [
    {
      id: "poro-herder.me",
      filter: { object: "self", type: "unit" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(buffInstruction.linkedTo, undefined);
});

test("ogn-061-298 Poro Herder: draw 1 is a separate sentence, not linked to the buff", () => {
  assert.equal(drawInstruction.id, "poro-herder.draw-1");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);
});

test("ogn-061-298 Poro Herder golden: buff me places one Buff and Draw 1 happens", () => {
  const { kernel, outcome } = runBody();
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => entry.id), [
    "poro-herder.buff-me",
    "poro-herder.draw-1"
  ]);
  assert.equal(kernel.getObject("poro-herder").buffs, 1);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[1].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.buffedCount, 1);
  assert.equal(outcome.results[1].result.linkedValues.drawn, 1);
});

test("ogn-061-298 Poro Herder golden: an already-buffed host is not buffed again, and Draw 1 still happens (CR 702.3.a / 359.3.e.14.a)", () => {
  const { kernel, outcome } = runBody({ buffs: 1 });
  assert.equal(kernel.getObject("poro-herder").buffs, 1);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  // The primitive reports the no-op through its own result status; the Buff
  // counter count in the world is the observable that must not change
  // (702.3.a: a second Buff is simply not placed).
  assert.equal(outcome.results[1].result.status, "executed");
  assert.equal(kernel.player("A").handSize, 1);
});

test("ogn-061-298 Poro Herder golden: a stale host reference makes the buff ignored while the draw still resolves", () => {
  const base = world()
    .unit("poro-herder", { owner: "A", might: 3 })
    .unit("placeholder", { owner: "A", might: 1 })
    .deck(["deck-1"], { owner: "A" })
    .build();
  const kernel = base.clone({
    source: base.ref("poro-herder"),
    sourceSnapshot: base.getObject("poro-herder")
  });
  const stale = kernel.ref("poro-herder");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  kernel.setTargets("poro-herder.me", [stale]);

  const outcome = resolveChainBody(triggered.body, kernel);
  assert.equal(outcome.results[0].result.status, "ignored");
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.equal(outcome.results[1].result.status, "executed");
  // The unit itself moved to hand (1) and Draw 1 added one more.
  assert.equal(kernel.getObject("poro-herder").zone, "hand");
  assert.equal(kernel.player("A").handSize, 2);
  assert.equal(outcome.results[1].result.linkedValues.drawn, 1);
});

test("ogn-061-298 Poro Herder golden: an empty deck still executes Draw 1 with zero drawn (CR 414.4)", () => {
  const { kernel, outcome } = runBody({ deck: [] });
  assert.equal(outcome.results[1].result.status, "executed");
  assert.equal(outcome.results[1].result.linkedValues.drawn, 0);
  assert.equal(kernel.getObject("poro-herder").buffs, 1);
});

// ---------------------------------------------------------------------------
// Not executable — TODO items with real causes (see judgeReason).
// ---------------------------------------------------------------------------

test.todo(
  "ogn-061-298 Poro Herder: the Trigger Condition needs a production evaluator — the event " +
    "pipeline requires a host testTrigger adapter for conditional triggers (only engine-core's " +
    "test helpers install one), the condition filter's controller placeholder has no resolver on " +
    "that path, and no merged consumer binds CardProgram triggered abilities at all (RIFT-257)."
);
