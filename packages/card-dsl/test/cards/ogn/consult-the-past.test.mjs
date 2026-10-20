import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/consult-the-past.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const play = program.abilities.find(ability => ability.kind === "play");
const drawInstruction = play.body[0];

test("Consult the Past program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Consult the Past identity, status, and keywords match the printing", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-2ebf1fe6e5ed7bb875f1c112b3e0ed1635b557c0c0ad550d752b8dd376243007"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.match(program.sourceText, /Draw 2./);

  // CR 811 Hidden and CR 813 Reaction are keyword abilities expanded by the
  // keyword registry (contract 3.7), carrying no numeric value.
  const keywords = program.abilities.filter(ability => ability.kind === "keyword");
  assert.deepEqual(keywords, [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "reaction" }
  ]);
  assert.equal(keywords[0].value, undefined);
  assert.equal(keywords[1].value, undefined);

  // The generated card registry indexes this program by canonicalCardId.
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Consult the Past play ability is a single untargeted effect.draw 2", () => {
  assert.equal(program.abilities.length, 3);
  assert.equal(play.body.length, 1);
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 2 } });
  // "Draw 2." has no target, pick, link, or per-instruction condition.
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.condition, undefined);
});

test("Consult the Past golden execution: Draw 2 moves the top two cards to hand", () => {
  const kernel = world().deck("bottom-card").deck("middle-card").deck("top-card").build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").handSize, 2);
  assert.equal(kernel.player("A").deckSize, 1);
  // CR 414.1.a: drawn from the top of the Main Deck.
  assert.deepEqual(
    kernel.zone("A", "hand").map(ref => ref.id),
    ["top-card", "middle-card"]
  );
  assert.deepEqual(run.events.map(event => event.action), ["draw"]);
  assert.deepEqual(run.result.linkedValues, { drawn: 2, drawnTo: "A" });
  assert.equal(run.linked.drawn, 2);
  assert.equal(run.linked.drawnTo, "A");
});

test("Consult the Past golden execution: a short deck draws as many as possible (CR 414.4)", () => {
  const kernel = world().deck("only-card").build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(run.linked.drawn, 1);
});

test.todo(
  "Consult the Past: Hide for [A] and the facedown Reaction play window need the Hidden " +
    "keyword expansion and facedown-zone support (RIFT-84), plus chain Closed/Open timing " +
    "permissions (RIFT-85 expansion lands with the layers/chain consumers in RIFT-91)."
);

// --- Production goldens: original registry program, real describePlay,
// ChainEngine speed/cost/pass/Resolve (test/fixtures/production-play.mjs).
// Printed: Spell, Mind, 4 Energy. The [Hidden] route stays the todo above.
import { productionPlay } from "../../fixtures/production-play.mjs";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const VOID_SEEKER = "card.hash-600e0796e82099284b213e87b112b1c5df42777ef72b70a3b4cd49a84d27dd10";
const ctpHand = { owner: "A", controller: "A", cardId: program.canonicalCardId, types: ["spell"], zone: "hand", energy: 4, power: null };

test("ogn-083-298 Consult the Past production: Reaction speed, pays 4 Energy and draws the top two cards", () => {
  const f = productionPlay({
    programs: [program],
    build: w => w.player("A", { energy: 4 }).player("B").object("ctp", ctpHand)
      .deck("bottom-card").deck("middle-card").deck("top-card"),
  });
  const draft = f.play("ctp");
  assert.equal(draft.speed, "reaction");
  assert.equal(f.kernel.player("A").energy, 0);
  assert.equal(f.kernel.getObject("top-card").zone, "hand");
  assert.equal(f.kernel.getObject("middle-card").zone, "hand");
  assert.equal(f.kernel.getObject("bottom-card").zone, "deck");
  assert.equal(f.kernel.getObject("ctp").zone, "trash");
});

test("ogn-083-298 Consult the Past production: as a Reaction it responds to an opposing spell on the opponent's turn", () => {
  const f = productionPlay({
    programs: [program, cardProgramsById.get(VOID_SEEKER)],
    turnPlayer: "B",
    answers: { "target:unit-at-battlefield": ["bf-unit"] },
    build: w => w.player("A", { energy: 4 }).player("B", { energy: 3, power: ["Fury"] })
      .object("ctp", ctpHand)
      .object("vs", { owner: "B", controller: "B", cardId: VOID_SEEKER, types: ["spell"], zone: "hand", energy: 3, power: ["Fury"] })
      .unit("bf-unit", { owner: "A", controller: "A", might: 5, location: { type: "battlefield", id: "bf-1" } })
      .deck("a-top").deck("a-second"),
  });
  f.engine.execute(f.describe("vs", "B"));
  f.engine.pass("B");
  assert.equal(f.engine.priority, "A");
  const draft = f.describe("ctp", "A");
  assert.equal(f.engine.canAct("A", draft.speed, f.kernel.getObject("ctp").ref, f.kernel.getObject("ctp")), true);
  f.engine.execute(draft);
  f.settle();
  assert.equal(f.kernel.player("A").handSize, 2, "Consult the Past resolved and drew two");
  assert.equal(f.kernel.getObject("bf-unit").damage, 4, "the opposing spell still resolved afterwards");
});
