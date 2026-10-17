import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/blind-fury.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import banish from "../../../../engine-core/dist/effects/instructions/effect.banish.js";
import reveal from "../../../../engine-core/dist/effects/instructions/effect.reveal.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [speed, play] = program.abilities;
const [revealInstruction, banishInstruction, playInstruction, recycleInstruction] = play.body;

test("Blind Fury program is valid EffectIR v2 data and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "judge-required");
  // The reason must name all three real gaps, not just one.
  assert.match(program.judgeReason, /each-opponent|逐个绑定/);
  assert.match(program.judgeReason, /355\.18/);
  assert.match(program.judgeReason, /356\.1\.b\.1/);
  assert.match(program.judgeReason, /play\/effect adapter|费用计划/);
});

test("Blind Fury identity, status and sourceText match the printing", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-5d9f81372ed036e6b436801528f2d8f8c5ebcc636cfa4c396219c28c446bdfac"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Each opponent reveals the top card of their Main Deck. Choose one and " +
      "banish it, then play it, ignoring its cost. Then recycle the rest."
  );
});

test("Blind Fury structure: [Action] plus reveal, choose/banish, ignoring-cost play, recycle the rest", () => {
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  // Printed cost (4 Energy + 2 Fury power) comes from the catalog.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 4 },
    power: { kind: "constant", value: 2 }
  });
  assert.deepEqual(
    play.body.map(instruction => [instruction.id, instruction.op]),
    [
      ["blind-fury.reveal-top-card-of-each-opponent", "effect.reveal-each-opponent"],
      ["blind-fury.banish-chosen", "effect.banish"],
      ["blind-fury.play-chosen", "effect.play"],
      ["blind-fury.recycle-the-rest", "effect.recycle"]
    ]
  );

  // The per-opponent reveal records the intended shape: one card from the top of
  // each opponent's Main Deck. The missing each-opponent binding and the
  // deck-top ordering are the judged part.
  assert.deepEqual(revealInstruction.args, {
    zone: { kind: "constant", value: "deck" },
    from: { kind: "constant", value: "top" },
    count: { kind: "constant", value: 1 }
  });

  // "Choose one and banish it": one non-target pick over the revealed set, then
  // the merged banish instruction. The choice itself is made on resolution
  // (355.18), which the merged picks cannot express yet.
  assert.equal(banishInstruction.linkedTo, revealInstruction.id);
  assert.deepEqual(banishInstruction.args.objects, {
    kind: "constant",
    value: { pick: "blind-fury.chosen-card" }
  });
  assert.equal(banishInstruction.picks.length, 1);
  assert.equal(banishInstruction.picks[0].id, "blind-fury.chosen-card");
  assert.equal(banishInstruction.picks[0].selection, "one");
  assert.deepEqual(banishInstruction.picks[0].options, [
    { kind: "linked-value", instructionId: revealInstruction.id, key: "revealed" }
  ]);

  // "...then play it, ignoring its cost." The play is linked to the banish and
  // consumes the banished object reference; the ignored-cost rule belongs to the
  // finalize cost plan (356.1.b.1), so no zeroed cost plan is smuggled in.
  assert.equal(playInstruction.linkedTo, banishInstruction.id);
  assert.deepEqual(playInstruction.args.object, {
    kind: "linked-value",
    instructionId: banishInstruction.id,
    key: "banishedObject"
  });
  assert.equal(Object.hasOwn(playInstruction.args, "cost"), false);

  // "Then recycle the rest." Recycles the same revealed set; effect.recycle
  // drops references that are no longer live, leaving exactly the unbanished
  // cards (417.1.c routes each card to its own owner's deck).
  assert.equal(recycleInstruction.linkedTo, banishInstruction.id);
  assert.deepEqual(recycleInstruction.args.objects, {
    kind: "linked-value",
    instructionId: revealInstruction.id,
    key: "revealed"
  });
});

test("Blind Fury golden execution: banish removes the chosen card, play returns it to the board", () => {
  const kernel = world().deck(["b-top"], { owner: "B" }).build();
  const chosen = kernel.ref("b-top");

  const banished = runInstruction(
    banish,
    banishInstruction.args,
    { world: kernel, picks: { "blind-fury.chosen-card": [chosen] } }
  );

  assert.equal(banished.result.status, "executed");
  assert.equal(banished.linked.banished.count, 1);
  assert.equal(kernel.getObject("b-top").zone, "banishment");
});

test("Blind Fury golden execution: 'recycle the rest' skips the already-banished card", () => {
  // Same reveal -> choose/banish -> recycle-the-rest shape as the program, with
  // the merged effect.reveal standing in for one opponent's reveal (the
  // per-opponent loop is the judged part). The revealed set holds two cards and
  // one has already left the deck for Banishment, so recycling the linked
  // revealed set must recycle exactly the remaining card and leave the banished
  // one in Banishment (417.1.c routes each card to its own owner's deck).
  const body = [
    { id: "stand-in-reveal", op: "effect.reveal",
      args: { player: { kind: "constant", value: "B" }, zone: { kind: "constant", value: "deck" }, count: { kind: "constant", value: 2 } } },
    { id: "blind-fury.banish-chosen", op: "effect.banish", linkedTo: "stand-in-reveal",
      args: { objects: { kind: "constant", value: { pick: "blind-fury.chosen-card" } } },
      picks: [{ id: "blind-fury.chosen-card", options: [{ kind: "linked-value", instructionId: "stand-in-reveal", key: "revealed" }], min: 1, max: 1, selection: "one" }] },
    { id: "blind-fury.recycle-the-rest", op: "effect.recycle", linkedTo: "blind-fury.banish-chosen",
      args: { objects: { kind: "linked-value", instructionId: "stand-in-reveal", key: "revealed" } } }
  ];
  const kernel = world().deck(["top-card", "under-card"], { owner: "B" }).build();
  const top = kernel.ref("top-card");
  kernel.setPicks("blind-fury.chosen-card", [top]);

  const outcome = resolveChainBody(body, kernel);

  const reveal = outcome.results.find(result => result.id === "stand-in-reveal");
  const recycle = outcome.results.find(result => result.id === "blind-fury.recycle-the-rest");
  assert.equal(reveal.result.status, "executed");
  assert.equal(recycle.result.status, "executed");
  assert.equal(recycle.result.linkedValues.recycledCount, 1);
  assert.equal(kernel.getObject("top-card").zone, "banishment");
  assert.equal(kernel.getObject("under-card").zone, "deck");
});

test("Blind Fury golden execution: the merged effect.reveal reveals one opponent's top card", () => {
  // The declared instruction's per-opponent loop is the judged part; the
  // reveal itself runs through the merged primitive with the same player/zone/
  // count shape for one opponent.
  const kernel = world().deck(["b-top"], { owner: "B" }).build();
  const run = runInstruction(
    reveal,
    {
      player: { kind: "constant", value: "B" },
      zone: revealInstruction.args.zone,
      count: revealInstruction.args.count
    },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.revealedCount, 1);
  assert.deepEqual(run.linked.revealed, [kernel.ref("b-top")]);
  assert.equal(kernel.getObject("b-top").zone, "deck");
  assert.deepEqual(run.events.map((event) => event.action), ["reveal"]);
});

test.todo(
  "Blind Fury: the per-opponent reveal needs an each-opponent binding plus " +
    "zoneSlice-ordered deck-top selection (effect.reveal does not use it yet), so each opponent reveals " +
    "the top card of their own Main Deck."
);

test.todo(
  "Blind Fury: choosing one of the revealed cards on resolution (355.18) needs " +
    "a resolution-time choice over a linked set, because the merged picks are " +
    "locked before resolution (finalizePick)."
);

test.todo(
  "Blind Fury: 'play it, ignoring its cost' needs the ignore-base cost " +
    "modification (356.1.b.1, with 356.1.b.3 keeping later increases applied) in " +
    "the finalize cost plan generated by the play/effect adapter; effect.play deliberately does not " +
    "implement it."
);
