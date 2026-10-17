import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/jae-medarda.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-41956626d8e2085aa462cfe2ee446c4b1d4f6fed16272a0a937256f92f5d68bb";
const SOURCE_TEXT = "When you choose me with a spell, draw 1.";

const [ability] = program.abilities;
const [drawOne] = ability.body;

test("sfd-142-221 Jae Medarda: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-142-221 Jae Medarda: identity, ruleset, executable status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-142-221 Jae Medarda: a Targeting Effect on became-target whose body draws 1", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);

  // 383.4.b / 383.4.b.3: a Targeting Effect subscribes to the became-target
  // timing point. "me" binds through the symbolic self anchor the merged
  // adapter translates to an objectId anchor; "with a spell" discriminates the
  // payload source snapshot's type (133.3.a: a spell exists on the chain);
  // 383.4.b.1 / 190.6.d's "you" is the ability controller (player: "self").
  assert.equal(ability.trigger.at, "became-target");
  assert.deepEqual(ability.trigger.filter, {
    event: "became-target",
    self: true,
    source: { type: "spell" },
    player: "self"
  });

  // 414.1 / 414.3: draw 1 for the ability's controller (190.6.d's implicit "you").
  assert.equal(ability.body.length, 1);
  assert.equal(drawOne.id, "jae-medarda.draw-1");
  assert.equal(drawOne.op, "effect.draw");
  assert.deepEqual(drawOne.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawOne.targets, undefined);
  assert.equal(drawOne.picks, undefined);
  assert.equal(drawOne.linkedTo, undefined);
});

test("sfd-142-221 Jae Medarda golden: the body really draws 1 for the ability controller", () => {
  // The array form sets an explicit top-to-bottom deck order (testing README).
  const kernel = world().deck(["top", "second"], { owner: "A" }).build();
  const run = runInstruction(draw, drawOne.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.deepEqual(run.events.map((event) => event.action), ["draw"]);
  // 414.1.a: the draw takes the top card of the Main Deck into Hand.
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["top"]);
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["second"]);
});

test("sfd-142-221 Jae Medarda golden: an empty Main Deck draws zero without faking a card (414.4)", () => {
  const kernel = world().build();
  const run = runInstruction(draw, drawOne.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 0);
  assert.deepEqual(kernel.zone("A", "hand"), []);
});

/**
 * Production harness: ChainEngine + EventPipeline + the program binding
 * (RIFT-257). Jae enters the Board through engine.commit so
 * attachProgramLifecycle installs the card's TriggerRegistration exactly as
 * the merged lifecycle does.
 */
function chainFixture() {
  const binding = createProgramBinding({ cardPrograms: [program] });
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .base("jae", { cardId: CARD_ID, types: ["unit"], energy: 5, power: ["Chaos"], might: 5 })
    .unit("dummy", { types: ["unit"], might: 2, owner: "B", controller: "B" })
    .unit("ability-unit", { types: ["unit"], might: 3 })
    .hand("bolt", { types: ["spell"], energy: 1, power: [] })
    .hand("bolt-b", { types: ["spell"], energy: 1, power: [], owner: "B" })
    .deck(["A:d1", "A:d2", "A:d3"], { owner: "A" })
    .deck(["B:d1", "B:d2", "B:d3"], { owner: "B" })
    .build();
  const decide = (request) => {
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    if (request.type === "optional") return true;
    throw new Error(`Unexpected choice ${JSON.stringify(request)}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: decide }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  binding.attachLifecycle(engine);
  // 383.4.b.2 / lifecycle: the card's triggers are installed when the unit
  // enters the Board through the pipeline. Jae moves from Base to a battlefield.
  engine.commit({ type: "move-zone", object: kernel.ref("jae"), to: "battlefield", location: { type: "battlefield", id: "bf-1" } });
  engine.advance();
  return { engine, kernel };
}

function spellDraft(fixtureState, id, source, player, target, speed = "normal") {
  return {
    id,
    controller: player,
    source: fixtureState.kernel.getObject(source),
    kind: "spell",
    speed,
    body: [],
    cost: { id: `cost:${id}`, cost: { energy: { kind: "constant", value: 0 } } },
    targets: [
      {
        requirement: { id: `${id}.target`, filter: { type: "unit", zone: "board" }, min: 1, max: 1, selection: "one" },
        options: { selected: [target] }
      }
    ]
  };
}

function abilityDraft(fixtureState, id, source, player, target) {
  return {
    id,
    controller: player,
    source: fixtureState.kernel.getObject(source),
    kind: "activated",
    speed: "reaction",
    body: [],
    cost: { id: `cost:${id}`, cost: { energy: { kind: "constant", value: 0 } } },
    targets: [
      {
        requirement: { id: `${id}.target`, filter: { type: "unit", zone: "board" }, min: 1, max: 1, selection: "one" },
        options: { selected: [target] }
      }
    ]
  };
}

function drain(engine) {
  let guard = 0;
  while (engine.items.length) {
    if (++guard > 80) throw new Error("Nonterminating test chain");
    engine.pass(engine.priority);
  }
}

test("sfd-142-221 Jae Medarda golden: your spell choosing Jae draws 1 through the real trigger pipeline", () => {
  const f = chainFixture();
  const handBefore = f.kernel.player("A").handSize; // 1: the bolt still in hand
  const deckBefore = f.kernel.player("A").deckSize;

  f.engine.execute(spellDraft(f, "a-spell", "bolt", "A", f.kernel.ref("jae")));
  assert.deepEqual(f.engine.items.map((item) => item.kind), ["spell", "triggered"]);
  drain(f.engine);

  // The bolt left hand for the Chain and the Targeting Effect drew exactly 1.
  assert.equal(f.kernel.getObject("bolt").zone, "trash");
  assert.equal(f.kernel.player("A").handSize, handBefore);
  assert.equal(f.kernel.player("A").deckSize, deckBefore - 1);
  assert.equal(f.engine.pipeline.events.filter((event) => event.timingPoint === "became-target").length, 1);
  assert.equal(f.engine.pipeline.events.filter((event) => event.timingPoint === "card-drawn").length, 1);
});

test("sfd-142-221 Jae Medarda golden: an opponent's spell choosing Jae never draws for you", () => {
  const f = chainFixture();
  f.engine.execute(spellDraft(f, "a-spell", "bolt", "A", f.kernel.ref("dummy")));
  f.engine.pass(f.engine.priority); // priority reaches B
  const handBefore = f.kernel.player("A").handSize; // 0: bolt is on the Chain

  f.engine.execute(spellDraft(f, "b-spell", "bolt-b", "B", f.kernel.ref("jae"), "reaction"));
  assert.deepEqual(f.engine.items.map((item) => item.kind), ["spell", "spell"]);
  drain(f.engine);

  // 383.4.b.1/190.6.d: "you" is the ability controller; B's choice is not yours.
  assert.equal(f.kernel.player("A").handSize, handBefore);
  assert.equal(f.kernel.player("A").deckSize, 3);
});

test("sfd-142-221 Jae Medarda golden: an ability (not a spell) choosing Jae does not trigger it (383.4.b.3)", () => {
  const f = chainFixture();
  f.engine.execute(spellDraft(f, "a-spell", "bolt", "A", f.kernel.ref("dummy")));
  drain(f.engine); // the spell resolves; the chain closes again
  const handBefore = f.kernel.player("A").handSize;
  const deckBefore = f.kernel.player("A").deckSize;

  f.engine.execute(abilityDraft(f, "a-ability", "ability-unit", "A", f.kernel.ref("jae")));
  assert.deepEqual(f.engine.items.map((item) => item.kind), ["activated"]);
  drain(f.engine);

  // The source snapshot is a unit, not a spell: no Targeting Effect fires.
  assert.equal(f.kernel.player("A").handSize, handBefore);
  assert.equal(f.kernel.player("A").deckSize, deckBefore);
  // The ability still produced its own became-target event (source: unit).
  const targeted = f.engine.pipeline.events.filter((event) => event.timingPoint === "became-target");
  assert.equal(targeted.length, 2);
  assert.deepEqual(targeted.at(-1).source.types, ["unit"]);
});
