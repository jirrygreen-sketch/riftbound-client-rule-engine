import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/lunar-boon.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-9e6fd20cf02fe1fa8c5b7c57c70ffbd3900b55bc4509cbd90f50efb0587b8b2f";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Discard 1, then draw 2.";

const [reactionKeyword, play] = program.abilities;
const [discardInstruction, drawInstruction] = play.body;

test("unl-125-219 Lunar Boon: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-125-219 Lunar Boon: identity, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-125-219 Lunar Boon: [Reaction], printed 3 energy and the discard-then-draw body", () => {
  assert.deepEqual(reactionKeyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(reactionKeyword.value, undefined);

  assert.equal(play.kind, "play");
  // Catalog printing: 3 energy, no printed power (never rewritten to 0).
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 }
  });
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["lunar-boon.discard-1", "effect.discard"],
      ["lunar-boon.draw-2", "effect.draw"]
    ]
  );
  // "Discard 1" is the effect discard of the ability's controller: no target
  // and no pick (355.10.a keeps Hand cards non-targeted, 423.1.a lets the
  // discarding player choose privately).
  assert.deepEqual(discardInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(discardInstruction.targets, undefined);
  assert.equal(discardInstruction.picks, undefined);
  assert.equal(discardInstruction.linkedTo, undefined);
  // "then draw 2" is an independent sentence: an empty hand negates the
  // discard and the draw still happens (359.3.e.11 has this exact example), so
  // the draw carries no link to the discard (359.3.e.14).
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 2 } });
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.condition, undefined);
});

test("unl-125-219 Lunar Boon golden: discard 1 then draw 2 through the real primitives", () => {
  const kernel = world()
    .hand("kept", { owner: "A" })
    .hand("discarded", { owner: "A" })
    .deck(["top", "second", "third"], { owner: "A" })
    .build();
  // The private Hand choice is replayed by the interpreter's path-scoped
  // request id (interpreter README); the primitive's default choice id is
  // "effect.discard:<player>".
  kernel.setAnswers({
    "lunar-boon.discard-1/effect.discard%3AA": [kernel.ref("discarded")]
  });

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["lunar-boon.discard-1", "executed"],
      ["lunar-boon.draw-2", "executed"]
    ]
  );
  // 423.1: the chosen card went from Hand to its owner's Trash; 414.1: the two
  // drawn cards left the top of the Main Deck for Hand.
  assert.deepEqual(kernel.zone("A", "trash").map((ref) => ref.id), ["discarded"]);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["kept", "top", "second"]);
  assert.deepEqual(outcome.events.map((event) => event.action), ["discard", "draw"]);
  assert.equal(outcome.results[0].result.linkedValues.discarded.count, 1);
  assert.equal(outcome.results[1].result.linkedValues.drawn, 2);
});

test("unl-125-219 Lunar Boon golden: an empty hand negates the discard and still draws 2 (359.3.e.11)", () => {
  const kernel = world().deck(["top", "second", "third"], { owner: "A" }).build();

  const outcome = resolveChainBody(play.body, kernel);

  // The discard cannot be followed at all, so it is negated as impossible; the
  // draw is a separate sentence and still resolves as much as possible.
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, {
    status: "negated",
    reason: "impossible",
    events: []
  });
  assert.equal(outcome.results[1].result.status, "executed");
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top", "second"]);
  assert.deepEqual(kernel.zone("A", "trash"), []);
});

test("unl-125-219 Lunar Boon golden: a short deck still draws what is available (414.4)", () => {
  const kernel = world()
    .hand("only-card", { owner: "A" })
    .deck(["last-card"], { owner: "A" })
    .build();
  kernel.setAnswers({
    "lunar-boon.discard-1/effect.discard%3AA": [kernel.ref("only-card")]
  });

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.zone("A", "trash").map((ref) => ref.id), ["only-card"]);
  // Burn Out handling (414.4 / 432) belongs to the kernel; the primitive only
  // reports what was actually drawn.
  assert.equal(outcome.results[1].result.linkedValues.drawn, 1);
});

test.todo(
  "Lunar Boon: [Reaction] admission during a Closed State on any player's turn (CR 813.1.b/813.1.c, " +
    "159.2.b) belongs to the keyword registry expansion plus the chain's canAct check (contract 3.5 / RIFT-85 / RIFT-120)"
);

test.todo(
  "Lunar Boon: the Finalize-time base cost payment (3 energy, CR 356.1.c / 204.1) and the burn-out " +
    "continuation for a short Main Deck (CR 414.4 / 432) belong to the cost plan and the kernel"
);
