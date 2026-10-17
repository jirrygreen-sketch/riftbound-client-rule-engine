import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/reksai-swarm-queen.js";
import recycle from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import reveal from "../../../../engine-core/dist/effects/instructions/effect.reveal.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";

const CANONICAL = "card.hash-66da1ff0419b3ebf3d4e801af0a225acbd65b392adf96224c9e14101755c0716";
const [ability] = program.abilities;
const [mayReveal] = ability.body;
const [revealInstruction, mayPlay, recycleRest] = mayReveal.args.body.value;
const [playOne] = mayPlay.args.body.value;

test("sfd-170-221 Rek'Sai, Swarm Queen: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /ordered picks/);
  assert.match(program.judgeReason, /RIFT-66/);
  assert.match(program.judgeReason, /RIFT-261/);
  // Refreshed reason: the cost opcodes are merged; the gap is the missing
  // finalized-plan producer on the game-effect Play path.
  assert.match(program.judgeReason, /原语已合入/);
  assert.match(program.judgeReason, /费用计划生成方/);
  // The type gate is expressible; the gap is the missing object list on
  // effect.play's receipt.
  assert.match(program.judgeReason, /played 计数|linkKey/);
  assert.equal(
    program.sourceText,
    "When I attack, you may reveal the top 2 cards of your Main Deck. You may play one. Then " +
      "recycle the rest. If the played card is a unit, you may play it here."
  );
});

test("sfd-170-221 Rek'Sai, Swarm Queen: attack trigger with the optional reveal wrapper", () => {
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "attack-declared");
  assert.deepEqual(ability.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  // Contract 3.9: "you may reveal ..." wraps the chosen instructions in body.
  assert.equal(mayReveal.id, "reksai.may-reveal");
  assert.equal(mayReveal.op, "choice.optional");
  assert.deepEqual(mayReveal.args.body.value.map((entry) => entry.id), [
    "reksai.reveal",
    "reksai.may-play",
    "reksai.recycle-rest"
  ]);
});

test("sfd-170-221 Rek'Sai, Swarm Queen: reveal reads the ordered top-two pick, rest recycles", () => {
  // 425.1 / 425.2.a reveal of a Secret zone; the top-2 slice must arrive as an
  // ordered pick because query order is not deck order (RIFT-66 zoneSlice).
  assert.equal(revealInstruction.op, "effect.reveal");
  assert.deepEqual(revealInstruction.args.pick, {
    kind: "constant",
    value: "reksai.top-two"
  });
  assert.deepEqual(revealInstruction.picks, [
    {
      id: "reksai.top-two",
      options: ["dynamic:main-deck-top-two"],
      min: 2,
      max: 2,
      selection: "any",
      filter: { zone: "deck", owner: "controller" }
    }
  ]);

  assert.equal(mayPlay.op, "choice.optional");
  assert.equal(mayPlay.linkedTo, "reksai.reveal");
  assert.equal(playOne.op, "effect.play");
  assert.equal(playOne.linkedTo, "reksai.reveal");
  assert.equal(playOne.args.location, undefined);
  assert.deepEqual(playOne.picks[0].options, [
    { kind: "linked-value", instructionId: "reksai.reveal", key: "revealed" }
  ]);

  // 417.1.a/417.1.c: the rest go to the bottom of their owner's Main Deck.
  assert.equal(recycleRest.op, "effect.recycle");
  assert.equal(recycleRest.linkedTo, "reksai.reveal");
  assert.deepEqual(recycleRest.args.objects, {
    kind: "linked-value",
    instructionId: "reksai.reveal",
    key: "revealed"
  });
});

test("sfd-170-221 Rek'Sai, Swarm Queen: the merged reveal primitive reveals the locked ordered top two", () => {
  const kernel = world().player("A").deck(["c1", "c2", "c3"]).build();
  const top = kernel.zoneSlice("A", "deck", "top", 2).map((object) => object.ref);
  assert.deepEqual(top.map((ref) => ref.id), ["c1", "c2"]);
  const run = runInstruction(
    reveal,
    { pick: "reksai.top-two" },
    { world: kernel, picks: { "reksai.top-two": top } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.revealed, top);
  assert.equal(run.linked.revealedCount, 2);
  // 425.1.a.2: revealed cards stay in their zone, order unchanged.
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["c1", "c2", "c3"]);
});

test("sfd-170-221 Rek'Sai, Swarm Queen: recycling the rest drops references already played", () => {
  const kernel = world().player("A").deck(["c1", "c2", "c3"]).build();
  const top = kernel.zoneSlice("A", "deck", "top", 2).map((object) => object.ref);
  // c1 was "played" (moved out of the deck); only c2 is still recyclable.
  kernel.perform({
    type: "move-zone",
    object: top[0],
    to: "board",
    location: { type: "base", player: "A" }
  });
  const run = runInstruction(
    recycle,
    { objects: { kind: "linked-value", instructionId: "reksai.reveal", key: "revealed" } },
    { world: kernel, linked: { revealed: top } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.recycled, [{ id: "c2", zoneEntryId: 1 }]);
  assert.equal(run.linked.recycledCount, 1);
  // 417.1.a: c2 lands at the bottom of the Main Deck.
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["c3", "c2"]);
});

test("sfd-170-221 Rek'Sai, Swarm Queen: declining the reveal skips the whole chosen body", () => {
  const kernel = world()
    .player("A")
    .deck(["c1", "c2", "c3"])
    .unit("reksai", { zone: "board", might: 5, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("reksai") });
  scoped.setAnswers({ "reksai.may-reveal/optional": false });
  const outcome = runAbilityBody(ability.body, scoped);
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason]),
    [["reksai.may-reveal", "negated", "skipped"]]
  );
  assert.equal(scoped.player("A").deckSize, 3);
  assert.deepEqual(outcome.events, []);
});

test.todo(
  "sfd-170-221 Rek'Sai, Swarm Queen: produce the ordered Main-Deck-top picks for effect.reveal and " +
    "generate the chosen revealed card's cost plan for effect.play (RIFT-8x ordered deck-top " +
    "provisioning, RIFT-89)"
);

test.todo(
  "sfd-170-221 Rek'Sai, Swarm Queen: gate the second 'you may play it here' entry-location choice on " +
    "'if the played card is a unit' — the compare/in test itself is merged, but effect.play's link receipt " +
    "only records the played count (number), so there is no linked object whose types could be tested; " +
    "the 355.2.b location permission then has no gate to open"
);
// Direct evidence for the third recorded gap: the merged effect.play receipt
// links only the played count (number) — never the played object references —
// so the printed "if the played card is a unit" gate has no linked object to
// read types from. The cost plan is constructed explicitly here (gap 2's
// missing producer is the judge-required surface recorded above) so this test
// exercises exactly gap 3.
import { buildCostPlan } from "../../../../engine-core/dist/cost/index.js";
import play from "../../../../engine-core/dist/effects/instructions/effect.play.js";

test("sfd-170-221 Rek'Sai, Swarm Queen: a real effect.play receipt links only the played count, not the played card", () => {
  const kernel = world().player("A").deck(["c1", "c2", "c3"]).build();
  const top = kernel.zoneSlice("A", "deck", "top", 2).map((object) => object.ref);
  // Explicit finalized plan (gap 2 already covers the missing producer); the
  // play itself really moves the chosen revealed card out of the deck.
  const costPlan = buildCostPlan(kernel, {
    id: "reksai.play-test",
    cost: { kind: "explicit", energy: { kind: "constant", value: 0 } }
  });

  const run = runInstruction(
    play,
    { pick: "reksai.revealed-play", linkKey: "played", cost: { kind: "constant", value: costPlan } },
    { world: kernel, picks: { "reksai.revealed-play": [top[0]] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["c2", "c3"]);
  // The receipt carries the count only: no object list means no linked object
  // whose types could gate "if the played card is a unit" (CR 355.2.b).
  assert.deepEqual(Object.keys(run.linked), ["played"]);
  assert.equal(typeof run.linked.played, "number");
});

