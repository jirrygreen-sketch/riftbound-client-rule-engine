import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/promising-future.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-d7bf59ee29e8ca9c306efe1bf2bd701f4edb154b5dea8674d4b6dc7aff35f61d";
const SOURCE_TEXT =
  "Each player looks at the top 5 cards of their Main Deck, chooses one, then recycles the rest. " +
  "Starting with the next player, each player plays those cards, ignoring Energy costs. (They must still pay Power costs.)";

const play = program.abilities[0];
const [look, recycle, playChosen] = play.body;

test("Promising Future program is structurally valid and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "judge-required");
  // The judgeReason must name the actual gaps (contract 3.1 / README §2).
  assert.match(program.judgeReason, /effect\.inspect/);
  assert.match(program.judgeReason, /417\.5/);
  assert.match(program.judgeReason, /420\.3\/420\.4/);
  // The merged cost ops and card-program binding must not appear as missing
  // dependencies; the ordered-picks and per-player walk gaps stay listed.
  assert.match(program.judgeReason, /cost\.pay\/cost\.modify 与 ignore-base 算术、卡牌程序绑定均已合入/);
  assert.match(program.judgeReason, /ordered\/zoneSlice\/linked\/exclude/);
  assert.match(program.judgeReason, /非零 top-N 有序来源与 picks 生产接线/);
  assert.ok(!/RIFT-261/.test(program.judgeReason));
});

test("Promising Future identity and printed text match the catalog", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("Promising Future structure: the three printed stages in order", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.body.map(instruction => [instruction.id, instruction.op]), [
    ["each-player-look-top-5", "effect.inspect"],
    ["each-player-recycle-rest", "effect.recycle"],
    ["each-player-plays-chosen", "effect.play-for-each-player"]
  ]);
});

test("Promising Future structure: each player looks at the top 5 of their own Main Deck and chooses one", () => {
  // Non-zero top-N looks need an ordered upstream collection (effect.inspect's
  // documented boundary: query() does not guarantee deck order), and the
  // inspecting set spans every player (355.10.e).
  assert.deepEqual(look.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(look.args.amount, { kind: "constant", value: 5 });
  assert.deepEqual(look.args.zone, { kind: "constant", value: "deck" });
  assert.deepEqual(look.args.player, { kind: "constant", value: "each-player" });
  assert.deepEqual(look.args.choose, { kind: "constant", value: true });
  assert.deepEqual(look.args.chooseCount, { kind: "constant", value: { min: 1, max: 1 } });
  assert.deepEqual(look.args.choiceId, { kind: "constant", value: "promising-future.choose-one" });
  // A look is Chooser-only information (128.3-128.4); the choice is a Look
  // permission, not a Board target, so no TargetSpec is declared.
  assert.equal(look.targets, undefined);
  assert.equal(look.picks, undefined);
});

test("Promising Future structure: the residue is recycled and the chosen card is played", () => {
  // "then recycles the rest": 417.5's simultaneous random-order placement is a
  // kernel concern; the instruction references the look's result (359.3.e.14).
  assert.deepEqual(recycle.args.objects, {
    kind: "linked-value",
    instructionId: "each-player-look-top-5",
    key: "inspected-rest"
  });
  assert.equal(recycle.linkedTo, "each-player-look-top-5");
  assert.equal(recycle.targets, undefined);

  // "Starting with the next player, each player plays those cards, ignoring
  // Energy costs. (They must still pay Power costs.)" — "those cards" are the
  // chosen ones, and the override must ignore Energy only (356.1/356.2).
  // No merged opcode walks players in turn order or applies a partial cost
  // waiver, so the pending op is named explicitly rather than overloading a
  // merged schema.
  assert.deepEqual(playChosen.args.objects, {
    kind: "linked-value",
    instructionId: "each-player-look-top-5",
    key: "inspected-pick"
  });
  assert.deepEqual(playChosen.args.cost, {
    kind: "constant",
    value: { finalized: true, ignore: ["energy"], pay: ["power"] }
  });
  assert.deepEqual(playChosen.args.order, { kind: "constant", value: "starting-with-next-player" });
  assert.equal(playChosen.linkedTo, "each-player-look-top-5");
  assert.equal(playChosen.targets, undefined);
});

test.todo(
  "Promising Future: each player looking at the top 5 of their own Main Deck needs a " +
    "non-zero top-N inspect over an ordered collection (effect.inspect's documented " +
    "blocker; 414.4/432.1.c for the look itself, 355.10.e for the multi-player shape; " +
    "the ordered PickSpec vocabulary is RIFT-358, in flight)."
);

test.todo(
  "Promising Future: recycling the rest needs 417.5's simultaneous random-order placement " +
    "for the Main Deck (kernel shuffle through the deterministic random source) plus the " +
    "non-target selection of the unchosen cards."
);

test.todo(
  "Promising Future: each player playing the card they chose, in turn order, ignoring " +
    "Energy costs while still paying Power (420.3/420.3.b.1, 356.1/356.2), needs a turn-order " +
    "walk that no merged opcode provides plus the card-side per-object ignore-Energy plan " +
    "producer for effect.play (the cost.pay/cost.modify arithmetic and the card-program play " +
    "binding are merged)."
);
