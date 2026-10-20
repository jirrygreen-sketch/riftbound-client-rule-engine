// Show of Strength (sfd-106-221): original CardProgram through ProgramBinding,
// the default ChainEngine and the real EventPipeline.
// Official source: Core Rules v1.5, published 2026-10-09 and effective
// 2026-10-16
// (https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf).
// Interaction evidence: CR 706-708/710 (current Might >= 5), 813.1.b/c and
// 309.1.a (Reaction in Closed State), 414.1/414.3 (Draw); canonical identity
// card.hash-7be9e4bed44d19de26a4a7a292ab8406e43694b33916fc5246d46347fa4ad85f.
import assert from "node:assert/strict";
import test from "node:test";

import program from "../../../dist/cards/sfd/show-of-strength.js";
import premonition from "../../../dist/cards/sfd/premonition.js";
import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { abilitySpeed } from "../../../../engine-core/dist/programs/keywords.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";

const CARD_ID = "card.hash-7be9e4bed44d19de26a4a7a292ab8406e43694b33916fc5246d46347fa4ad85f";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Draw 1 for each of your [Mighty] units. (A unit is Mighty while it has " +
  "5+ :rb_might:.)";
const [reaction, play] = program.abilities;
const [drawInstruction] = play.body;

test("sfd-106-221 Show of Strength: validates, registers and is executable", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(result.value.canonicalCardId, CARD_ID);
  assert.equal(result.value.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(result.value.status, "executable");
  assert.equal(result.value.judgeReason, undefined);
  assert.equal(result.value.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-106-221 Show of Strength: structure — Reaction plus a count-driven draw", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.equal(reaction.value, undefined);
  assert.equal(keywordDefinitionsById.get("Reaction").valued, false);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });

  assert.equal(play.body.length, 1);
  assert.equal(drawInstruction.id, "draw-per-mighty");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, {
    amount: {
      kind: "count",
      subject: "unit",
      filter: { type: "unit", controller: "you", mightGte: 5 }
    }
  });
  // "your Mighty units" is a programmatic set query, never a target or pick
  // (CR v1.5 355.10; the printed text does not choose any unit).
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.condition, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

const playAndResolve = [
  { type: "play", object: "show", player: "A" },
  { type: "pass", player: "A" },
  { type: "pass", player: "B" }
];

function scenario({ four = null, five = null, six = null, enemy = null, extraObjects = [], operations = playAndResolve } = {}) {
  return {
    players: { A: { energy: 5, power: ["Body"] }, B: { energy: 1 } },
    objects: [
      { id: "show", cardId: CARD_ID, program, owner: "A", types: ["spell"], zone: "hand", energy: 2, power: ["Body"], might: null },
      ...(four === null ? [] : [{ id: "friendly-four", owner: "A", types: ["unit"], zone: "board", might: four }]),
      ...(five === null ? [] : [{ id: "friendly-five", owner: "A", types: ["unit"], zone: "board", might: five }]),
      ...(six === null ? [] : [{ id: "friendly-six", owner: "A", types: ["unit"], zone: "board", might: six }]),
      ...(enemy === null ? [] : [{ id: "enemy-eight", owner: "B", types: ["unit"], zone: "board", might: enemy }]),
      { id: "deck-one", owner: "A", types: ["unit"], zone: "deck", might: 1 },
      { id: "deck-two", owner: "A", types: ["unit"], zone: "deck", might: 1 },
      { id: "deck-three", owner: "A", types: ["unit"], zone: "deck", might: 1 },
      ...extraObjects
    ],
    operations
  };
}

test("sfd-106-221 Show of Strength: zero Mighty units still plays and draws zero", () => {
  const result = runCardScenario(program, {
    ...scenario({ four: 4, enemy: 8 }),
    expect: {
      objects: {
        show: { zone: "trash" },
        "friendly-four": { zone: "board", might: 4 },
        "enemy-eight": { zone: "board", might: 8 }
      },
      players: { A: { energy: 3, power: [], handSize: 0, deckSize: 3 } },
      links: { "draw-per-mighty.drawn": 0, "draw-per-mighty.drawnTo": "A" },
      events: { includes: [{ timingPoint: "chain-item-resolve", object: { ref: "show" } }] }
    }
  });
  result.asserts();
  assert.equal(result.events.some(event => event.timingPoint === "card-drawn"), false);
});

test("sfd-106-221 Show of Strength: exactly one friendly unit at the Might 5 boundary draws one", () => {
  const result = runCardScenario(program, {
    ...scenario({ four: 4, five: 5, enemy: 8 }),
    expect: {
      objects: {
        show: { zone: "trash" },
        "friendly-four": { might: 4 },
        "friendly-five": { might: 5 },
        "enemy-eight": { might: 8 }
      },
      players: { A: { energy: 3, power: [], handSize: 1, deckSize: 2 } },
      links: { "draw-per-mighty.drawn": 1, "draw-per-mighty.drawnTo": "A" },
      events: { includes: [{ timingPoint: "card-drawn", action: { type: "draw", player: "A", amount: 1 } }] }
    }
  });
  result.asserts();
});

test("sfd-106-221 Show of Strength: multiple friendly Mighty units draw their exact count and opponents do not count", () => {
  const result = runCardScenario(program, {
    ...scenario({ four: 4, five: 5, six: 6, enemy: 8 }),
    expect: {
      objects: {
        show: { zone: "trash" },
        "friendly-five": { might: 5 },
        "friendly-six": { might: 6 },
        "enemy-eight": { might: 8 }
      },
      players: { A: { energy: 3, power: [], handSize: 2, deckSize: 1 } },
      links: { "draw-per-mighty.drawn": 2, "draw-per-mighty.drawnTo": "A" }
    }
  });
  result.asserts();
  assert.deepEqual(
    result.events.filter(event => event.timingPoint === "card-drawn").map(event => event.object?.ref.id),
    ["deck-two", "deck-one"]
  );
});

test("sfd-106-221 Show of Strength: [Reaction] binds through the real program and closes a chain on another player's turn", () => {
  const kernel = world()
    .player("A", { energy: 5, power: ["Body"] })
    .player("B", { energy: 5, power: ["Mind", "Mind", "Mind"] })
    .hand("show", { cardId: CARD_ID, types: ["spell"], energy: 2, power: ["Body"], might: null })
    .hand("opener", { cardId: premonition.canonicalCardId, types: ["spell"], energy: 2, power: ["Mind"], might: null })
    .deck(["deck-one", "deck-two"], { owner: "A" })
    .deck(["opener-draw-one", "opener-draw-two", "opener-draw-three"], { owner: "B" })
    .unit("mighty", { owner: "A", might: 5 })
    .build();
  const requests = [];
  const choose = request => { requests.push(request); throw new Error(`Unexpected choice ${request.id}`); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const binding = createProgramBinding({ cardPrograms: [program, premonition] });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "B", phase: "main", host, cleanup: () => false, describePlay: binding.describePlay });
  binding.attachLifecycle(engine, error => { throw error; });
  const source = kernel.getObject("show");
  const draft = binding.describePlay({ type: "play", object: source.ref, player: "A" }, source);
  assert.equal(draft.speed, "reaction");
  assert.equal(abilitySpeed(program.abilities, source), "reaction");
  const openerSource = kernel.getObject("opener");
  engine.execute(binding.describePlay({ type: "play", object: openerSource.ref, player: "B" }, openerSource));
  engine.pass("B");
  assert.equal(engine.turnState, "neutral-closed");
  assert.equal(engine.canAct("B", "normal", source.ref, source), false);
  assert.equal(engine.canAct("A", draft.speed, source.ref, source), true);
  engine.execute(draft);
  engine.pass("A");
  assert.equal(engine.priority, "B");
  assert.equal(engine.canAct("A", draft.speed, source.ref, source), false, "only the Priority holder can respond");
  assert.equal(engine.canAct("A", "normal", source.ref, source), false);
  engine.pass("B");
  assert.equal(kernel.player("A").energy, 3);
  assert.deepEqual(kernel.player("A").power, []);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.linked("draw-per-mighty.drawn"), 1);
  assert.equal(kernel.getObject("show").zone, "trash");
  // The B-owned Premonition was below Show of Strength and remains on the
  // chain until its own Resolution window closes.
  assert.equal(kernel.getObject("opener").zone, "chain");
  for (let guard = 0; engine.items.length; guard++) {
    assert.ok(guard < 10, "the real chain settles without recursion");
    engine.pass(engine.priority);
  }
  assert.equal(kernel.player("B").handSize, 3);
  assert.deepEqual(requests, []);
});

test("sfd-106-221 Show of Strength: a layer change after Finalize makes Show of Strength recount at Resolve", () => {
  const defiantDance = cardRegistryById.get("card.hash-b159649107e1268bfb45d5d2c64def273ae76898db17907192d8e25e1d7526ef");
  assert.equal(defiantDance.status, "executable");
  const result = runCardScenario(program, {
    players: { A: { energy: 6, power: ["Body", "Calm"] }, B: { energy: 1 } },
    objects: [
      { id: "show-dynamic", cardId: CARD_ID, program, owner: "A", types: ["spell"], zone: "hand", energy: 2, power: ["Body"], might: null },
      { id: "dance", cardId: defiantDance.canonicalCardId, program: defiantDance, owner: "A", types: ["spell"], zone: "hand", energy: 1, power: ["Calm"], might: null },
      { id: "rise", owner: "A", types: ["unit"], zone: "board", might: 3 },
      { id: "fall", owner: "A", types: ["unit"], zone: "board", might: 3 },
      { id: "enemy", owner: "B", types: ["unit"], zone: "board", might: 5 },
      { id: "deck-one", owner: "A", types: ["unit"], zone: "deck" },
      { id: "deck-two", owner: "A", types: ["unit"], zone: "deck" },
      { id: "deck-three", owner: "A", types: ["unit"], zone: "deck" }
    ],
    answers: {
      "target:defiant-dance.unit": ["rise"],
      "target:defiant-dance.another-unit": ["fall"]
    },
    operations: [
      { type: "play", object: "show-dynamic", player: "A" },
      { type: "play", object: "dance", player: "A" },
      { type: "pass", player: "A" },
      { type: "pass", player: "B" },
      { type: "pass", player: "A" },
      { type: "pass", player: "B" }
    ],
    expect: {
      objects: {
        "show-dynamic": { zone: "trash" },
        dance: { zone: "trash" },
        rise: { might: 5 },
        fall: { might: 1 },
        enemy: { might: 5 }
      },
      players: { A: { energy: 3, power: [], handSize: 1, deckSize: 2 } },
      links: { "draw-per-mighty.drawn": 1 }
    }
  });
  result.asserts();
  const showFinalize = result.events.findIndex(event => event.timingPoint === "chain-item-finalize" && event.object?.ref.id === "show-dynamic");
  const danceResolve = result.events.findIndex(event => event.timingPoint === "chain-item-resolve" && event.object?.ref.id === "dance");
  const showResolve = result.events.findIndex(event => event.timingPoint === "chain-item-resolve" && event.object?.ref.id === "show-dynamic");
  assert.ok(showFinalize >= 0 && showFinalize < danceResolve && danceResolve < showResolve);
});
