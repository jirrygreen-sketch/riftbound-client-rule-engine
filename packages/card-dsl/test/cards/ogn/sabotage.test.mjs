import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import sabotage from "../../../dist/cards/ogn/sabotage.js";
import reveal from "../../../../engine-core/dist/effects/instructions/effect.reveal.js";
import recycle from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
// Card bodies execute through the production argument adapter (chain/engine.ts
// -> resolveChainBody) rather than a hand-built primitive call sequence.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const [play] = sabotage.abilities;
const [revealInstruction, recycleInstruction] = play.body;

test("Sabotage program is structurally valid and judge-required", () => {
  const result = validateCardProgram(sabotage);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(sabotage.status, "judge-required");
  assert.match(sabotage.judgeReason, /355\.7/);
  assert.match(sabotage.judgeReason, /effect\.recycle/);
  assert.match(sabotage.judgeReason, /执行测试/);
  assert.equal(sabotage.rulesetVersion, "core-1.5");
  assert.equal(
    sabotage.canonicalCardId,
    "card.hash-ec4ca2df92b603ace480ec363b3bd1f1ce182f05602b2dd361a08eadfd7574a6"
  );
  assert.equal(
    sabotage.sourceText,
    "Choose an opponent. They reveal their hand. Choose a non-unit card from it, and recycle that card."
  );
});

test("Sabotage structure: opponent target, hand reveal, then recycle of the chosen card", () => {
  assert.equal(sabotage.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["sabotage.reveal-hand", "effect.reveal"],
      ["sabotage.recycle-chosen-card", "effect.recycle"]
    ]
  );

  // "Choose an opponent" targets a player (355.7/355.9.a); the merged
  // ObjectFilter cannot match players, so the target records that shape and the
  // reveal carries the unbound placeholder.
  assert.equal(revealInstruction.targets.length, 1);
  assert.equal(revealInstruction.targets[0].id, "sabotage.opponent");
  assert.deepEqual(revealInstruction.targets[0].filter, { kind: "player", player: "opponent" });
  assert.equal(revealInstruction.targets[0].selection, "one");
  assert.deepEqual(revealInstruction.args.player, { kind: "constant", value: "opponent" });
  // "They reveal their hand": the hand zone with no count (425.3.a).
  assert.deepEqual(revealInstruction.args.zone, { kind: "constant", value: "hand" });
  assert.equal(revealInstruction.args.count, undefined);
  assert.equal(revealInstruction.linkedTo, undefined);

  // "Choose a non-unit card from it, and recycle that card": a resolve-time
  // non-target choice over the revealed cards, on the linked reveal.
  assert.equal(recycleInstruction.linkedTo, "sabotage.reveal-hand");
  assert.deepEqual(recycleInstruction.args.choose, {
    kind: "constant",
    value: {
      id: "sabotage.recycle-choice",
      filter: { zone: "hand", owner: "opponent", notType: "unit" },
      chooser: "controller",
      visibility: "public",
      prompt: "Choose a non-unit card from the revealed hand to recycle."
    }
  });
  assert.equal(recycleInstruction.picks, undefined);
  assert.equal(recycleInstruction.args.objects, undefined);
  assert.equal(recycleInstruction.args.from, undefined);
});

test("Sabotage golden: revealing the opponent's hand presents exactly those cards (425.3.a)", () => {
  const kernel = world()
    .hand("opponent-spell", { owner: "B", types: ["spell"] })
    .hand("opponent-unit", { owner: "B", types: ["unit"] })
    .hand("own-card", { owner: "A", types: ["spell"] })
    .build();
  const run = runInstruction(
    reveal,
    { player: { kind: "constant", value: "B" }, zone: revealInstruction.args.zone },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  // CR 425.1.a.2: revealed cards stay in their zone; only the opponent's hand
  // is presented.
  assert.deepEqual(run.linked.revealed.map((ref) => ref.id), ["opponent-spell", "opponent-unit"]);
  assert.equal(kernel.player("B").handSize, 2);
  assert.equal(kernel.player("A").handSize, 1);
});

test("Sabotage golden: recycling a chosen revealed card sends it to its owner's deck bottom", () => {
  const kernel = world()
    .hand("chosen-spell", { owner: "B", types: ["spell"] })
    .hand("kept-unit", { owner: "B", types: ["unit"] })
    .build();
  const chosenRef = kernel.ref("chosen-spell");
  const run = runInstruction(
    recycle,
    { objects: { kind: "constant", value: { id: chosenRef.id, zoneEntryId: chosenRef.zoneEntryId } } },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  // CR 417.1.a / 417.1.c: recycled to the bottom of its owner's Main Deck.
  assert.equal(run.linked.recycledCount, 1);
  // effect.recycle links the pre-move references of the cards it recycled
  // (effect.recycle.ts: "recycled" = the successful refs).
  assert.deepEqual(run.linked.recycled, [{ id: "chosen-spell", zoneEntryId: 1 }]);
  assert.equal(kernel.player("B").handSize, 1);
  assert.deepEqual(kernel.zone("B", "deck").map((ref) => ref.id), ["chosen-spell"]);
  assert.deepEqual(run.events.map((event) => event.action), ["recycle"]);
});

test.todo(
  "Sabotage golden: end to end — the opponent is bound from the player target, their hand is " +
    "revealed, a non-unit card is chosen, and that card is recycled; needs the player-target/pick " +
    "IR form plus the resolve-time recycle choice descriptor (see judgeReason)"
);

test("Sabotage golden: reveal -> inspect choice -> linked recycle executes a legal non-unit choice", () => {
  const kernel = world()
    .hand("revealed-spell", { owner: "B", types: ["spell"] })
    .hand("revealed-unit", { owner: "B", types: ["unit"] })
    .build();
  const chosen = kernel.ref("revealed-spell");
  kernel.setAnswers({ "sabotage.inspect-revealed/sabotage.recycle-choice": [chosen] });
  // Bind the unsupported player target and use the real inspect choice instead
  // of the removed reveal picker/pickCount arguments. This exercises a legal
  // spell choice; enforcing the non-unit filter remains the card's TODO.
  const [{ targets, ...revealInstructionWithoutTarget }, recycleInstructionAsAuthored] = play.body;
  const body = [
    {
      ...revealInstructionWithoutTarget,
      args: {
        ...revealInstruction.args,
        // The unresolved "opponent" placeholder from the card is replaced by
        // the concrete opponent for this execution; binding it from a player
        // target is exactly the missing IR form (see judgeReason).
        player: { kind: "constant", value: "B" }
      }
    },
    {
      id: "sabotage.inspect-revealed",
      op: "effect.inspect",
      linkedTo: revealInstruction.id,
      args: {
        player: { kind: "constant", value: "A" },
        zone: { kind: "constant", value: { owner: "B", zone: "hand" } },
        choose: { kind: "constant", value: true },
        chooseCount: { kind: "constant", value: { min: 1, max: 1 } },
        choiceId: { kind: "constant", value: "sabotage.recycle-choice" }
      }
    },
    {
      ...recycleInstructionAsAuthored,
      // The authored "choose" descriptor is not implemented on effect.recycle
      // (primitive rule: one of target / objects / from). Consume the real
      // inspect result, leaving the other revealed card in the opponent's hand.
      args: {
        objects: {
          kind: "linked-value",
          instructionId: "sabotage.inspect-revealed",
          key: "inspected-pick"
        }
      }
    }
  ];
  const outcome = resolveChainBody(body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [
      ["sabotage.reveal-hand", "executed"],
      ["sabotage.inspect-revealed", "executed"],
      ["sabotage.recycle-chosen-card", "executed"]
    ]
  );
  assert.equal(outcome.linkedValues["sabotage.reveal-hand.revealed"][0].id, "revealed-spell");
  assert.equal(outcome.linkedValues["sabotage.reveal-hand.revealedCount"], 2);
  assert.deepEqual(outcome.linkedValues["sabotage.inspect-revealed.inspected-pick"], [chosen]);
  assert.equal(outcome.linkedValues["sabotage.recycle-chosen-card.recycledCount"], 1);
  assert.deepEqual(kernel.zone("B", "deck").map((ref) => ref.id), ["revealed-spell"]);
  assert.equal(kernel.player("B").handSize, 1);
  assert.equal(kernel.getObject("revealed-unit").zone, "hand");
  assert.deepEqual(outcome.events.map(event => event.action), ["reveal", "reveal", "look", "recycle"]);
});

test("Sabotage reveal clause: a player expression naming no seat fails closed (negated/impossible, 425.2)", () => {
  // effect.reveal documents that an unresolvable player expression is
  // impossible rather than silently revealing another player's hand. The
  // authored clause carries the `opponent` placeholder until the player
  // target binding lands (judgeReason); this pins the primitive's fail-closed
  // contract without depending on the placeholder spelling.
  const kernel = world().hand("opponent-card", { owner: "B", types: ["spell"] }).build();
  const run = runInstruction(
    reveal,
    { player: { kind: "constant", value: "opponent" }, zone: revealInstruction.args.zone },
    { world: kernel }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(kernel.player("B").handSize, 1);
});

test("Sabotage recycle clause: a supplied revealed reference recycles to its owner's deck bottom (417.1.a/417.1.c)", () => {
  // The selected object reference is the one piece the current IR can carry;
  // effect.recycle itself is real. The resolve-time choose descriptor and the
  // non-unit filter belong to the missing pipeline (judgeReason), so this
  // golden supplies the reference the choice would produce.
  const kernel = world().hand("unit-card", { owner: "B", types: ["unit"] }).build();
  const run = runInstruction(
    recycle,
    { objects: { kind: "constant", value: { id: "unit-card", zoneEntryId: 1 } } },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.recycledCount, 1);
  assert.deepEqual(kernel.zone("B", "deck").map((ref) => ref.id), ["unit-card"]);
  assert.equal(kernel.player("B").handSize, 0);
});

test.todo(
  "Sabotage opponent choice: 'Choose an opponent' is a player target (355.7/355.9.a); the IR " +
    "needs a player-target/pick form and a binding that feeds effect.reveal's player argument " +
    "(target.player)"
);

test.todo(
  "Sabotage card choice: effect.recycle needs a resolve-time non-target choose descriptor " +
    "(like effect.stun/effect.exhaust) with a non-unit filter, made by the spell's controller " +
    "over the revealed hand (417.1.a, 425.4)"
);

