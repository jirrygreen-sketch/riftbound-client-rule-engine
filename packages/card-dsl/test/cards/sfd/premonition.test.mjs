import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/premonition.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID = "card.hash-281e4f29c74b8ba799276e97df9e961d0366cf7c8b6fd6c90bb383574d9f40c5";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Draw 3.";

const [reaction, play] = program.abilities;
const [drawInstruction] = play.body;

test("sfd-087-221 Premonition: program passes validateCardProgram and is executable", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
});

test("sfd-087-221 Premonition: identity, ruleset and verbatim text", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("sfd-087-221 Premonition: [Reaction] keyword plus the printed 2 energy + 3 Mind power cost", () => {
  assert.equal(program.abilities.length, 2);
  // 813: Reaction is a pure permission; the merged KeywordDef owns the
  // continuous.timing expansion and the chain owns admission (3.5 / 3.7).
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.equal(reaction.value, undefined);
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 3 }
  });
});

test("sfd-087-221 Premonition: a single untargeted Draw 3 instruction", () => {
  assert.equal(play.body.length, 1);
  assert.equal(drawInstruction.id, "premonition.draw-3");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 3 } });
  // "Draw 3." has no target, pick, link, condition or mode.
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.condition, undefined);
  assert.equal(instructionDefinitionsById.get("effect.draw"), draw);
  // The declared [Reaction] keyword really is in the merged keyword registry.
  assert.equal(keywordDefinitionsById.get("Reaction").valued, false);
});

test("sfd-087-221 Premonition golden: Draw 3 moves the top three cards to hand", () => {
  // An array builds the deck top-to-bottom.
  const kernel = world().deck(["top-card", "middle-card", "bottom-card"]).build();

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").handSize, 3);
  assert.equal(kernel.player("A").deckSize, 0);
  // 414.1.a: cards are drawn from the top of the Main Deck, top first.
  assert.deepEqual(
    kernel.zone("A", "hand").map((ref) => ref.id),
    ["top-card", "middle-card", "bottom-card"]
  );
  assert.deepEqual(outcome.results[0].result.linkedValues.drawn, 3);
  // 190.6.d: the implicit drawer is the ability controller.
  assert.equal(outcome.results[0].result.linkedValues.drawnTo, "A");
});

test("sfd-087-221 Premonition golden: a short deck draws as many as possible (414.4)", () => {
  const kernel = world().deck(["only-card"]).build();

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(outcome.results[0].result.linkedValues.drawn, 1);
});

test("sfd-087-221 Premonition golden: an empty deck reports the actual drawn count", () => {
  const kernel = world().build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 0);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 0);
});

test.todo(
  "sfd-087-221 Premonition: [Reaction] admission itself (play during a Closed State on any player's turn and " +
    "resolve before the items already on the Chain, CR 813.1.b/813.1.c/159.2.b.3) belongs to the chain's canAct " +
    "check plus the continuous.timing consumer (contract 3.5 / RIFT-91) — not to this card."
);
