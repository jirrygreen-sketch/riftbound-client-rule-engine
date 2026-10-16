import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/decree-of-strength.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import reveal from "../../../../engine-core/dist/effects/instructions/effect.reveal.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-a8174733ce8471dd791d71e2914a7f93d9d2f6c25c8d7937bead01c30d962f4a";
const SOURCE_TEXT =
  "Choose an opponent. They reveal their hand and you choose a Mind " +
  "(:rb_rune_mind:) card from it. They recycle that card.";

const [play] = program.abilities;
const [revealInstruction, recycleInstruction] = play.body;

test("ven-085-166 Decree of Strength: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-085-166 Decree of Strength: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-085-166 Decree of Strength: judgeReason names the player target, recycle choice and domain gaps", () => {
  assert.match(program.judgeReason, /target\.player/);
  assert.match(program.judgeReason, /355\.7/);
  assert.match(program.judgeReason, /effect\.recycle/);
  assert.match(program.judgeReason, /355\.18/);
  assert.match(program.judgeReason, /417\.1\.a/);
  assert.match(program.judgeReason, /RIFT-9/);
  assert.match(program.judgeReason, /不近似实现/);
});

test("ven-085-166 Decree of Strength: printed 1 Energy cost plus reveal-hand and recycle instructions", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  // Printed base cost 1 Energy; the catalog's power is null (no printed Power),
  // which is never rewritten as 0 (README section 2).
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 1 }
  });
  assert.deepEqual(play.body.map(instruction => [instruction.id, instruction.op]), [
    ["decree-of-strength.reveal-hand", "effect.reveal"],
    ["decree-of-strength.recycle-mind-card", "effect.recycle"]
  ]);

  // 355.7 / 355.9.a: "Choose an opponent" names a player, which the merged
  // ObjectFilter cannot match; the shape is recorded for review (judgeReason).
  assert.deepEqual(revealInstruction.targets, [
    {
      id: "decree-of-strength.opponent",
      filter: { kind: "player", player: "opponent" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  // 425.3.a: revealing a zone with no count presents every card in it; the
  // revealer is the chosen opponent, whose player-target binding is missing.
  assert.deepEqual(revealInstruction.args.player, { kind: "constant", value: "opponent" });
  assert.deepEqual(revealInstruction.args.zone, { kind: "constant", value: "hand" });
  assert.equal(revealInstruction.args.count, undefined);
  assert.equal(revealInstruction.linkedTo, undefined);

  // 355.18 / 417.1.a: the Mind card is chosen on resolution and then recycled;
  // effect.recycle has no resolve-time choose descriptor and the domain
  // predicate has no consumer, so the instruction stays data-only.
  assert.equal(recycleInstruction.linkedTo, "decree-of-strength.reveal-hand");
  assert.deepEqual(recycleInstruction.args.choose, {
    kind: "constant",
    value: {
      id: "decree-of-strength.chosen-card",
      filter: { zone: "hand", owner: "opponent", domain: "Mind" },
      chooser: "controller",
      visibility: "public",
      prompt: "Choose a Mind card from the revealed hand to recycle."
    }
  });
  assert.equal(recycleInstruction.picks, undefined);
  assert.equal(recycleInstruction.args.objects, undefined);
  assert.equal(recycleInstruction.args.from, undefined);
  assert.equal(recycleInstruction.args.target, undefined);
});

test("ven-085-166 Decree of Strength golden: the opponent's whole hand is presented (425.3.a)", () => {
  const kernel = world()
    .hand("opponent-mind", { owner: "B", types: ["spell"], power: ["Mind"] })
    .hand("opponent-unit", { owner: "B", types: ["unit"] })
    .hand("caster-card", { owner: "A", types: ["spell"] })
    .build();
  // The player-target binding that would feed effect.reveal's `player` argument
  // is the missing IR form (judgeReason); the reveal half is executed with the
  // concrete opponent the spell's first sentence names.
  const run = runInstruction(
    reveal,
    { player: { kind: "constant", value: "B" }, zone: revealInstruction.args.zone },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  // 425.1.a.2: revealed cards stay in their zone; only the opponent's hand is
  // presented, and the caster's own hand is untouched.
  assert.deepEqual(run.linked.revealed.map(ref => ref.id), ["opponent-mind", "opponent-unit"]);
  assert.equal(run.linked.revealedCount, 2);
  assert.equal(kernel.player("B").handSize, 2);
  assert.equal(kernel.getObject("opponent-mind").zone, "hand");
  assert.deepEqual(kernel.objectsInZone("A", "hand").map(ref => ref.id), ["caster-card"]);
});

test("ven-085-166 Decree of Strength golden: an empty opponent hand reveals nothing (425.3.a)", () => {
  const kernel = world().player("B").build();
  const run = runInstruction(
    reveal,
    { player: { kind: "constant", value: "B" }, zone: { kind: "constant", value: "hand" } },
    { world: kernel }
  );

  // No revealable object exists, so the primitive reports negated/impossible and
  // links the empty result; it never invents a card.
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.deepEqual(run.linked.revealed, []);
  assert.equal(run.linked.revealedCount, 0);
  assert.deepEqual(kernel.zone("B", "hand"), []);
});

test.todo(
  "ven-085-166 Decree of Strength: choose an opponent as a player target and bind it into the following " +
    "reveal (CR 355.7 / 355.9.a) — needs the IR player-target form and a binding expression that feeds " +
    "effect.reveal's `player` argument (RIFT-9 target.player / RIFT-90 target plan)"
);

test.todo(
  "ven-085-166 Decree of Strength: choose a Mind card from the revealed hand on resolution and have its " +
    "owner recycle it (CR 355.18 / 417.1.a / 417.1.c) — needs a resolve-time non-target choose descriptor " +
    "on effect.recycle plus a predicate for \"the card's Domain includes Mind\"; neither the descriptive " +
    "choose descriptor nor the domain filter has a merged consumer"
);
