import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/dauntless-vanguard.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";

test("sfd-093-221 Dauntless Vanguard: program validates and has expected shape", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "executable");
  assert.equal(
    program.canonicalCardId,
    "card.hash-cf0b322a78010676e3d8b287830194a3bdc8970e65a141578ae8a3074ebd956f"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, "You may play me to an occupied enemy battlefield.");
});

test("sfd-093-221 Dauntless Vanguard: single static play-location permission", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "play-location-permission");
  const value = ability.effect.value;
  assert.equal(value.kind, "constant");
  assert.deepEqual(value.value, {
    zone: "battlefield",
    battlefield: { occupied: true, controller: "opponent" },
    appliesTo: "self"
  });
  assert.equal(ability.effect.duration, "while-in-hand");
  assert.equal(ability.condition, undefined);
});

// Official sources: Core Rules v1.5 (2026-10-09),
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// and Radiance patch notes (effective 2026-10-16),
// https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/.
// Rules: 170.11.a (occupied), 355.2.a/.b (destination and an added legal
// destination), 337.1 (Finalize pays and validates), 338-340 (Priority then
// Resolve), and 359.2 (Unit entry).  For canonicalCardId
// card.hash-cf0b322a78010676e3d8b287830194a3bdc8970e65a141578ae8a3074ebd956f:
// A Plays it from Hand to B's occupied Battlefield.  The permission is installed
// by the shipped lifecycle while the card is in Hand; Finalize checks that exact
// destination and pays 4 Energy + 1 Body; both players then pass before Resolve
// moves it to the enemy battlefield.  No object is read through LKI.
function dauntlessFixture({ location = { type: "battlefield", id: "enemy-field" } } = {}) {
  const kernel = world()
    .player("A", { energy: 4, power: ["Body"] })
    .player("B")
    .unit("enemy-occupant", {
      owner: "B",
      controller: "B",
      might: 2,
      location: { type: "battlefield", id: "enemy-field" }
    })
    .hand("dauntless", {
      cardId: program.canonicalCardId,
      types: ["unit"],
      energy: 4,
      power: null,
      might: 4
    })
    .build();
  const requests = [];
  const choose = request => {
    requests.push(request);
    if (request.type === "optional") return true;
    if (request.type === "select-objects" && request.min === request.max &&
        request.options.length === request.min) return [...request.options];
    throw new Error(`Unexpected production choice ${request.type} ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const binding = createProgramBinding({ cardPrograms: [program] });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: () => false,
    describePlay: binding.describePlay
  });
  const errors = [];
  binding.attachLifecycle(engine, error => errors.push(error));
  engine.advance();
  const source = kernel.getObject("dauntless");
  const draft = binding.describePlay(
    { type: "play", player: "A", object: source.ref, location },
    source
  );
  return { kernel, engine, binding, errors, draft };
}

test("sfd-093-221 Dauntless Vanguard production golden: Finalize admits an occupied enemy battlefield and Resolve enters it", () => {
  const result = runCardScenario(program, {
    players: { A: { energy: 4 }, B: {} },
    objects: [
      {
        id: "dauntless",
        cardId: program.canonicalCardId,
        owner: "A",
        types: ["unit"],
        zone: "hand",
        energy: 4,
        power: null,
        might: 4
      },
      {
        id: "enemy-occupant",
        owner: "B",
        types: ["unit"],
        zone: "board",
        might: 2,
        location: { type: "battlefield", id: "enemy-field" }
      }
    ],
    operations: [{
      type: "play",
      object: "dauntless",
      player: "A",
      location: { type: "battlefield", id: "enemy-field" }
    }]
  });
  const source = result.state.objects.find(object => object.ref.id === "dauntless");
  assert.equal(source.zone, "board");
  assert.deepEqual(source.location, { type: "battlefield", id: "enemy-field" });
  assert.equal(result.state.players.A.energy, 0);
  assert.deepEqual(result.state.players.A.power, []);
  assert.equal(result.state.chain.length, 0);
  assert.equal(result.events.some(event => event.timingPoint === "card-played" &&
    event.object?.ref.id === "dauntless"), true);
});
