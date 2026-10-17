// Golden test for docs/rules/scenarios/privacy.yaml
//   scenario: privacy-draw-not-revealed-to-opponent (CR v1.5 414.1, 108.7.c)
//
// Subject: the Draw phase of the real TurnFlow driver plus src/projection/v2.
// The drawn card is moved by the engine's own draw GameAction; the projection
// then decides what each viewer learns from the zone change and the event.
import assert from "node:assert/strict";
import test from "node:test";
import { bindResolveContext, createActionPipelineHost, projectFor, projectionState, world } from "./harness.mjs";
import { TurnFlow } from "../../../dist/turn/flow.js";

function drawnFixture() {
  const kernel = world().player("A", { energy: 0 }).player("B", { energy: 0 }).build();
  for (const player of ["A", "B"]) {
    for (const index of [1, 2]) {
      kernel.addObject({
        ref: { id: player + "-d" + index, zoneEntryId: 1 }, cardId: "card:" + player + "-d" + index,
        name: player + "-d" + index, types: ["unit"], tags: [], keywords: [], owner: player, controller: player,
        zone: "deck", location: null, might: 1, energy: null, power: null, exhausted: false,
        damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false
      }, "deck");
    }
    kernel.addObject({
      ref: { id: player + "-r", zoneEntryId: 1 }, cardId: "card:" + player + "-r", name: player + "-r",
      types: ["rune"], tags: [], keywords: [], owner: player, controller: player, zone: "rune-deck",
      location: null, might: null, energy: null, power: null, exhausted: false,
      damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false
    }, "rune-deck");
  }
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => { throw new Error("the Draw phase makes no choices"); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: () => false
  });
  const flow = new TurnFlow({
    host, player: id => kernel.player(id), turnOrder: ["A", "B"],
    battlefields: [{ id: "bf1", controller: null }, { id: "bf2", controller: null }]
  });
  return { kernel, flow };
}

test("privacy-draw-not-revealed-to-opponent: the draw changes counts for everyone and faces for nobody but the owner", () => {
  const { kernel, flow } = drawnFixture();
  const topBefore = kernel.zone("A", "deck")[0].id;
  flow.start();

  // The Draw phase really ran: A's top card moved Deck -> Hand.
  assert.equal(flow.phase, "main");
  // The reference kernel stacks each newly added deck card on top, so 'd2' —
  // added second — is the card the Draw phase takes.
  assert.equal(topBefore, "A-d2");
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), [topBefore]);
  assert.equal(kernel.player("A").deckCount, 1);
  const drawEvents = flow.chain.pipeline.events.filter(event => event.timingPoint === "object-leaves-deck" ||
    event.timingPoint === "object-enters-hand");
  assert.equal(drawEvents.length, 2, "the zone change is journaled as leave/enter");

  const state = projectionState(kernel);
  const A = projectFor(state, "A");
  const B = projectFor(state, "B");
  const spectator = projectFor(state, null);
  assert.equal(A.players.A.hand.cards[0].cardId, "card:" + topBefore, "the owner reads the drawn card");
  assert.equal(B.players.A.hand.count, 1, "the opponent sees the new hand count");
  assert.equal(B.players.A.hand.cards[0].visibility, "face-down");
  assert.equal(B.players.A.hand.cards[0].cardId, undefined, "the opponent gets no card identity");
  assert.equal(spectator.players.A.hand.cards[0].visibility, "face-down");
  assert.equal(B.players.A.mainDeck.count, 1, "the deck count dropped in the opponent's view");
  assert.equal(B.players.A.mainDeck.cards.length, 0, "the opponent gets no deck card");
  assert.equal(JSON.stringify(B).includes("card:" + topBefore), false, "no identity leaks to the opponent");

  // The event channel is a second information path; its sanitization gap is
  // recorded in 414.1-card-drawn-event-payload-private.test.mjs.
});
