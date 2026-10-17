// RIFT-642 template-level golden for the `static||` group (12 published
// judge-required cards whose IR signature is a single static ability with no
// instruction body; see packages/card-dsl/src/cards/README.md 4.1).
//
// Method: every row names one card, its canonical identity, its own board, its
// own operations and its own expectation, and runs the real runCardScenario
// path (ProgramBinding -> ChainEngine -> EventPipeline -> layers).
//
// A passing row asserts only rule-correct state: either the printed outcome, or
// a plain "no change" observation such as an unmodified printed cost or an
// unmodified zone. Where the merged engine produces a value the printed card
// text does not support, that value is NOT written into a passing row; the
// printed expectation gets its own `todo` row under "pending printed goldens".
// All twelve published programs stay judge-required: these scenarios show a
// rejected binding, an inert registration, or a granted keyword that no runtime
// consumer expands.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { ProgramBindingError } from "../../../../engine-core/dist/programs/errors.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import annieFiery from "../../../dist/cards/ogs/annie-fiery.js";
import garenCommander from "../../../dist/cards/ogs/garen-commander.js";
import hextechRay from "../../../dist/cards/ogn/hextech-ray.js";
import wielderOfWater from "../../../dist/cards/ogn/wielder-of-water.js";
import windsweptHillock from "../../../dist/cards/ogn/windswept-hillock.js";
import clangingSentry from "../../../dist/cards/rad/clanging-sentry.js";
import huntersCircle from "../../../dist/cards/rad/hunters-circle.js";
import oriannaMechanicalMarvel from "../../../dist/cards/rad/orianna-mechanical-marvel.js";
import overloadedTraveler from "../../../dist/cards/rad/overloaded-traveler.js";
import starryEyedSongstress from "../../../dist/cards/rad/starry-eyed-songstress.js";
import watchfulCurator from "../../../dist/cards/rad/watchful-curator.js";
import batteringRam from "../../../dist/cards/sfd/battering-ram.js";
import bubbleBot from "../../../dist/cards/sfd/bubble-bot.js";
import forecaster from "../../../dist/cards/sfd/forecaster.js";
import orbOfRegret from "../../../dist/cards/ogn/orb-of-regret.js";
import trustyRamhound from "../../../dist/cards/sfd/trusty-ramhound.js";

/** The scenario harness refuses judge-required programs by design. */
const executableView = program => ({ ...program, status: "executable", judgeReason: undefined });

const here = { type: "battlefield", id: "rift642-battlefield" };
const elsewhere = { type: "battlefield", id: "rift642-elsewhere" };
const baseA = { type: "base", player: "A" };

const unit = (id, cardId, values = {}) => ({
  id, cardId, types: ["unit"], zone: "board", location: here, might: 2, power: null, ...values,
});
const gear = (id, values = {}) => ({
  id, types: ["gear"], zone: "board", location: here, ...values,
});
const battlefield = (id, cardId) => ({
  id, cardId, types: ["battlefield"], zone: "board", location: here, might: null, energy: null, power: null,
});

const wielderId = wielderOfWater.canonicalCardId;
const hillockId = windsweptHillock.canonicalCardId;
const annieId = annieFiery.canonicalCardId;
const garenId = garenCommander.canonicalCardId;
const sentryId = clangingSentry.canonicalCardId;
const circleId = huntersCircle.canonicalCardId;
const oriannaId = oriannaMechanicalMarvel.canonicalCardId;
const travelerId = overloadedTraveler.canonicalCardId;
const songstressId = starryEyedSongstress.canonicalCardId;
const curatorId = watchfulCurator.canonicalCardId;
const ramId = batteringRam.canonicalCardId;
const forecasterId = forecaster.canonicalCardId;
const rayId = hextechRay.canonicalCardId;
const orbId = orbOfRegret.canonicalCardId;
const bubbleBotId = bubbleBot.canonicalCardId;
const ramhoundId = trustyRamhound.canonicalCardId;

/**
 * Gap probe: assert the exact production binding rejection for a card's static
 * ability and that the rejected declaration registered no continuous effect.
 */
const rejectsBinding = (program, pattern) => result => {
  const host = result.state.objects.find(object => object.cardId === program.canonicalCardId);
  assert.ok(host, `scenario host for ${program.canonicalCardId} is on the board`);
  const engine = fixture({ cards: [] }).engine;
  assert.throws(
    () => createEngineStaticBinder(engine).bindStatic(program.abilities[0], host),
    error => {
      assert.ok(error instanceof ProgramBindingError, String(error));
      assert.equal(error.code, "judge-required");
      assert.match(error.message, pattern);
      return true;
    }
  );
  assert.deepEqual(engine.layers.registry.list(), []);
};

// ---------------------------------------------------------------------------
// One row per assigned card: canonical identity, that card's own board, its own
// operations and its own expectation.
// ---------------------------------------------------------------------------
const rows = [
  {
    // 364.3.a + 461 + 740.2.a: the +2 requires the attacker/defender
    // designation. runCardScenario's objectConfig does not carry
    // ObjectSnapshot.combatRole into the test world, so a scenario host is never
    // in combat; the merged binder and condition still run, and the condition
    // really gates the +2 off. That is the printed outcome for this board.
    name: "Wielder of Water · out of combat the +2 Might condition is false",
    canonicalCardId: wielderId,
    sourceProgram: wielderOfWater,
    program: executableView(wielderOfWater),
    scenario: {
      objects: [unit("wielder", wielderId, { might: 2 })],
      operations: [],
      expect: {
        objects: { wielder: { zone: "board", might: 2, damage: 0, keywords: [], power: null } },
        events: { exact: [] },
      },
    },
  },
  {
    // 053.3: "here" is the Hillock; 810.1: Ganking is the granted keyword. The
    // current registration is inert, so the only rule-correct assertions are the
    // unchanged Hillock characteristics and the untouched far-away unit; the
    // printed grant for the co-located unit is the pending row below.
    name: "Windswept Hillock · the untouched unit elsewhere and the inert registration",
    canonicalCardId: hillockId,
    sourceProgram: windsweptHillock,
    program: executableView(windsweptHillock),
    scenario: {
      objects: [
        battlefield("hillock", hillockId),
        unit("unit-here", undefined, {}),
        unit("unit-elsewhere", undefined, { location: elsewhere }),
      ],
      operations: [],
      expect: {
        objects: {
          // Might is deliberately not asserted: the reference kernel's
          // defaultObject coerces a printed null Might to 1 (RIFT-641 has the
          // same pending row for Bandle Tree). energy/power do survive as null.
          hillock: { zone: "board", energy: null, power: null, keywords: [] },
          "unit-elsewhere": { zone: "board", keywords: [] },
        },
        events: { exact: [] },
      },
    },
    verify(result) {
      // Gap probe, not a rule claim: the binding succeeds (sameLocationAs ->
      // a concrete LocationRef) yet layers/filter.ts compares LocationRef by
      // object identity, so the registered filter matches no object at all.
      const host = result.state.objects.find(object => object.cardId === hillockId);
      const target = result.state.objects.find(object => object.ref.id === "unit-here");
      const engine = fixture({ cards: [] }).engine;
      createEngineStaticBinder(engine).bindStatic(windsweptHillock.abilities[0], host);
      const [entry] = engine.layers.registry.list();
      assert.deepEqual(entry.effect.filter.location, target.location, "the anchor stores an equal LocationRef value");
      assert.notEqual(entry.effect.filter.location, target.location, "but it is a different object identity");
      assert.equal(matchesObjectFilter(entry.effect.filter, target), false, "layers/filter.ts rejects the co-located unit");
    },
  },
  {
    // 712 / 715.2: Annie's grant would make this instance deal 4. The merged
    // spine really resolves the spell, so the row asserts the parts that hold
    // regardless of the missing grant (the spell leaves the hand, the damage
    // event fires, the cost is paid) and leaves the amount to its pending row.
    name: "Annie, Fiery · the Bonus Damage grant cannot register, the spell still resolves",
    canonicalCardId: annieId,
    sourceProgram: annieFiery,
    program: executableView(annieFiery),
    scenario: {
      players: { A: { energy: 10, power: ["Fury"] } },
      objects: [
        unit("annie", annieId, { might: 4, energy: 5, power: ["Fury"] }),
        { id: "ray", cardId: rayId, program: hextechRay, types: ["spell"], zone: "hand", location: null, energy: 1, power: ["Fury"] },
        unit("enemy", undefined, { owner: "B", controller: "B", might: 5 }),
      ],
      answers: { "target:hextech-ray.unit-at-battlefield": ["enemy"] },
      operations: [
        { type: "play", object: "ray", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: {
        objects: {
          annie: { zone: "board", might: 4, keywords: [] },
          ray: { zone: "trash" },
          enemy: { zone: "board", might: 5 },
        },
        players: { A: { energy: 9 } },
        events: { includes: [{ timingPoint: "damage-dealt" }, { timingPoint: "card-played" }] },
      },
    },
    verify: rejectsBinding(annieFiery, /Unsupported static appliesTo "controller-spells-and-abilities"/),
  },
  {
    // 190.6 / 740.1.b: "other friendly units here" is the controller's units at
    // the host's battlefield except the host. With nothing registered, the only
    // rule-correct assertions are the host's own printed Might, the untouched
    // non-friendly co-located unit and the untouched unit at another location;
    // the printed +1 for the co-located ally is the pending row below.
    name: "Garen, Commander · the source-relative aura cannot register; enemy and distant unit are untouched",
    canonicalCardId: garenId,
    sourceProgram: garenCommander,
    program: executableView(garenCommander),
    scenario: {
      objects: [
        unit("garen", garenId, { might: 5, energy: 6, power: ["Order"] }),
        unit("ally-here", undefined, { might: 2 }),
        unit("ally-elsewhere", undefined, { might: 3, location: baseA }),
        unit("enemy-here", undefined, { owner: "B", controller: "B", might: 4 }),
      ],
      operations: [],
      expect: {
        objects: {
          garen: { zone: "board", might: 5, keywords: [] },
          "ally-elsewhere": { zone: "board", might: 3 },
          "enemy-here": { zone: "board", might: 4 },
        },
        events: { exact: [] },
      },
    },
    verify: rejectsBinding(garenCommander, /Static exclude anchor needs a dynamic relative filter/),
  },
  {
    // 831.1.c.3: a printed Disarm with the value omitted is 1; "Your Mechs" is
    // the controller's Mech units. This is the printed scope outcome.
    name: "Clanging Sentry · your Mechs gain Disarm 1 and nothing else does",
    canonicalCardId: sentryId,
    sourceProgram: clangingSentry,
    program: executableView(clangingSentry),
    scenario: {
      objects: [
        unit("sentry", sentryId, { might: 2, energy: 3 }),
        unit("mech", undefined, { tags: ["Mech"], might: 2 }),
        unit("soldier", undefined, { might: 2 }),
        unit("enemy-mech", undefined, { owner: "B", controller: "B", tags: ["Mech"], might: 3 }),
      ],
      operations: [],
      expect: {
        objects: {
          sentry: { zone: "board", keywords: [] },
          mech: { zone: "board", keywords: [{ id: "disarm", value: 1 }] },
          soldier: { zone: "board", keywords: [] },
          "enemy-mech": { zone: "board", keywords: [] },
        },
        events: { exact: [] },
      },
    },
  },
  {
    // 356.4 / 356.4.a: the printed discount is on the played card's total cost;
    // no static is registered for other players here. The row asserts only that
    // the unmodified printed card and the board are left alone.
    name: "Hunters' Circle · the per-player first-play discount cannot register",
    canonicalCardId: circleId,
    sourceProgram: huntersCircle,
    program: executableView(huntersCircle),
    scenario: {
      players: { A: { energy: 3 } },
      objects: [
        battlefield("circle", circleId),
        unit("bystander", undefined, { might: 2 }),
      ],
      operations: [],
      expect: {
        objects: {
          circle: { zone: "board", energy: null, power: null },
          bystander: { zone: "board", might: 2 },
        },
        players: { A: { energy: 3 } },
        events: { exact: [] },
      },
    },
    verify: rejectsBinding(huntersCircle, /Unsupported static appliesTo "play-cost"/),
  },
  {
    // 366.2 / 404.2: the discount belongs in the cost plan of a future gear
    // play. Nothing consumes it, so the row only pins that the holding player's
    // pool and the card in hand keep their printed values.
    name: "Orianna, Mechanical Marvel · the gear discount cannot register",
    canonicalCardId: oriannaId,
    sourceProgram: oriannaMechanicalMarvel,
    program: executableView(oriannaMechanicalMarvel),
    scenario: {
      players: { A: { energy: 1, power: ["Fury"] } },
      objects: [
        unit("orianna", oriannaId, { might: 5, energy: 5 }),
        { id: "gear-card", owner: "A", types: ["gear"], zone: "hand", location: null, energy: 1, power: null },
      ],
      operations: [],
      expect: {
        objects: {
          orianna: { zone: "board", might: 5, keywords: [] },
          "gear-card": { zone: "hand", energy: 1, power: null },
        },
        players: { A: { energy: 1, power: ["Fury"] } },
        events: { exact: [] },
      },
    },
    verify: rejectsBinding(oriannaMechanicalMarvel, /Unsupported static appliesTo \{"type":"gear","controller":"controller"\}/),
  },
  {
    // 356.4: a friendly [Deploy] gear at my battlefield is the printed
    // configuration, and +1 Might is the printed outcome for it.
    name: "Overloaded Traveler · a friendly [Deploy] gear at my battlefield grants +1 Might",
    canonicalCardId: travelerId,
    sourceProgram: overloadedTraveler,
    program: executableView(overloadedTraveler),
    scenario: {
      objects: [
        unit("traveler", travelerId, { might: 2, energy: 2 }),
        gear("deploy-gear", { owner: "A", keywords: [{ id: "deploy" }] }),
      ],
      operations: [],
      expect: {
        objects: {
          traveler: { zone: "board", might: 3, keywords: [] },
          "deploy-gear": { zone: "board", keywords: [{ id: "deploy" }] },
        },
        events: { exact: [] },
      },
      // The qualifier itself is not evaluated: a gear without [Deploy] and an
      // opponent's gear satisfy the same condition. Those two boards are the
      // pending printed rows below.
    },
  },
  {
    // 356.2.b.1 / 415.4: the optional exhaust cost belongs to a spell play.
    // Nothing consumes it, so the row pins only the unchanged board and pool.
    name: "Starry-Eyed Songstress · the optional additional cost cannot register",
    canonicalCardId: songstressId,
    sourceProgram: starryEyedSongstress,
    program: executableView(starryEyedSongstress),
    scenario: {
      players: { A: { energy: 3 } },
      objects: [
        { id: "songstress", cardId: songstressId, types: ["legend"], zone: "board", location: here, might: null, energy: null, power: null },
        { id: "spell", owner: "A", types: ["spell"], zone: "hand", location: null, energy: 3, power: null },
        unit("unit-1", undefined, { might: 2 }),
        unit("unit-2", undefined, { might: 2 }),
        unit("unit-3", undefined, { might: 2 }),
      ],
      operations: [],
      expect: {
        objects: {
          songstress: { zone: "board", exhausted: false },
          spell: { zone: "hand", energy: 3 },
          "unit-1": { zone: "board", exhausted: false },
          "unit-2": { zone: "board", exhausted: false },
          "unit-3": { zone: "board", exhausted: false },
        },
        players: { A: { energy: 3 } },
        events: { exact: [] },
      },
    },
    verify: rejectsBinding(starryEyedSongstress, /Unsupported static appliesTo "play-spell-cost"/),
  },
  {
    // 809.1.b.3: a printed Deflect with the value omitted is 1; "Your gear" is
    // the controller's gear. This is the printed scope outcome.
    name: "Watchful Curator · your gear gains Deflect 1 and your units do not",
    canonicalCardId: curatorId,
    sourceProgram: watchfulCurator,
    program: executableView(watchfulCurator),
    scenario: {
      objects: [
        unit("curator", curatorId, { might: 4, energy: 3, power: ["Calm"] }),
        gear("own-gear", { owner: "A" }),
        unit("own-unit", undefined, { might: 2 }),
        gear("enemy-gear", { owner: "B", controller: "B" }),
      ],
      operations: [],
      expect: {
        objects: {
          curator: { zone: "board", keywords: [] },
          "own-gear": { zone: "board", keywords: [{ id: "deflect", value: 1 }] },
          "own-unit": { zone: "board", keywords: [] },
          "enemy-gear": { zone: "board", keywords: [] },
        },
        events: { exact: [] },
      },
    },
  },
  {
    // 356.4.e: the discount only exists once the card is played. Nothing
    // consumes it, so the row pins the unused card in hand at its printed cost.
    name: "Battering Ram · the dynamic self-discount cannot register",
    canonicalCardId: ramId,
    sourceProgram: batteringRam,
    program: executableView(batteringRam),
    scenario: {
      players: { A: { energy: 5 } },
      objects: [
        { id: "ram", cardId: ramId, types: ["unit"], zone: "hand", location: null, might: 5, energy: 5, power: null },
        unit("bystander", undefined, { might: 2 }),
      ],
      operations: [],
      expect: {
        objects: {
          ram: { zone: "hand", energy: 5, power: null },
          bystander: { zone: "board", might: 2 },
        },
        players: { A: { energy: 5 } },
        events: { exact: [] },
      },
    },
    verify: rejectsBinding(batteringRam, /Static ability kind continuous\.cost-modification has no layer mapping/),
  },
  {
    // 817.1 / 817.3: Vision is a readable permanent characteristic, and "Your
    // Mechs" is the controller's Mech units regardless of location.
    name: "Forecaster · your Mechs gain Vision and other units do not",
    canonicalCardId: forecasterId,
    sourceProgram: forecaster,
    program: executableView(forecaster),
    scenario: {
      objects: [
        unit("forecaster", forecasterId, { might: 2, energy: 2 }),
        unit("mech", undefined, { tags: ["Mech"], location: baseA }),
        unit("enemy-mech", undefined, { owner: "B", controller: "B", tags: ["Mech"] }),
        unit("plain", undefined, {}),
      ],
      operations: [],
      expect: {
        objects: {
          forecaster: { zone: "board", keywords: [] },
          mech: { zone: "board", location: baseA, keywords: [{ id: "Vision" }] },
          "enemy-mech": { zone: "board", keywords: [] },
          plain: { zone: "board", keywords: [] },
        },
        events: { exact: [] },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Boundary group: boards where the static's population clause has no eligible
// object, so the merged path really evaluates the clause and grants nothing.
// ---------------------------------------------------------------------------
const boundaryRows = [
  {
    name: "boundary (no eligible object) · Overloaded Traveler with no gear keeps its printed Might",
    canonicalCardId: travelerId,
    sourceProgram: overloadedTraveler,
    program: executableView(overloadedTraveler),
    scenario: {
      objects: [unit("traveler", travelerId, { might: 2 })],
      operations: [],
      expect: { objects: { traveler: { zone: "board", might: 2, keywords: [] } }, events: { exact: [] } },
    },
  },
  {
    name: "boundary (no eligible object) · Clanging Sentry with no friendly Mech grants nothing",
    canonicalCardId: sentryId,
    sourceProgram: clangingSentry,
    program: executableView(clangingSentry),
    scenario: {
      objects: [
        unit("sentry", sentryId, { might: 2 }),
        unit("soldier", undefined, {}),
        unit("enemy-mech", undefined, { owner: "B", controller: "B", tags: ["Mech"] }),
      ],
      operations: [],
      expect: {
        objects: {
          sentry: { zone: "board", keywords: [] },
          soldier: { zone: "board", keywords: [] },
          "enemy-mech": { zone: "board", keywords: [] },
        },
        events: { exact: [] },
      },
    },
  },
  {
    name: "boundary (no eligible object) · Watchful Curator with only an opponent gear grants nothing",
    canonicalCardId: curatorId,
    sourceProgram: watchfulCurator,
    program: executableView(watchfulCurator),
    scenario: {
      objects: [
        unit("curator", curatorId, { might: 4 }),
        gear("enemy-gear", { owner: "B", controller: "B" }),
      ],
      operations: [],
      expect: {
        objects: {
          curator: { zone: "board", keywords: [] },
          "enemy-gear": { zone: "board", keywords: [] },
        },
        events: { exact: [] },
      },
    },
  },
  {
    name: "boundary (no eligible object) · Forecaster with no friendly Mech grants nothing",
    canonicalCardId: forecasterId,
    sourceProgram: forecaster,
    program: executableView(forecaster),
    scenario: {
      objects: [
        unit("forecaster", forecasterId, { might: 2 }),
        unit("plain", undefined, {}),
        unit("enemy-mech", undefined, { owner: "B", controller: "B", tags: ["Mech"] }),
      ],
      operations: [],
      expect: {
        objects: {
          forecaster: { zone: "board", keywords: [] },
          plain: { zone: "board", keywords: [] },
          "enemy-mech": { zone: "board", keywords: [] },
        },
        events: { exact: [] },
      },
    },
  },
  {
    name: "boundary (condition not satisfied) · Wielder of Water beside a friendly unit out of combat gains nothing",
    canonicalCardId: wielderId,
    sourceProgram: wielderOfWater,
    program: executableView(wielderOfWater),
    scenario: {
      objects: [
        unit("wielder", wielderId, { might: 2 }),
        unit("friend", undefined, { might: 2 }),
      ],
      operations: [],
      expect: { objects: { wielder: { zone: "board", might: 2 } }, events: { exact: [] } },
    },
  },
  {
    name: "boundary (condition not satisfied) · Hunters' Circle with no play in progress modifies nothing",
    canonicalCardId: circleId,
    sourceProgram: huntersCircle,
    program: executableView(huntersCircle),
    scenario: {
      players: { A: { energy: 3 } },
      objects: [
        battlefield("circle", circleId),
        { id: "unit-card", owner: "A", types: ["unit"], zone: "hand", location: null, energy: 3, power: null },
      ],
      operations: [],
      expect: { players: { A: { energy: 3 } }, objects: { "unit-card": { zone: "hand", energy: 3 } }, events: { exact: [] } },
    },
  },
];

// ---------------------------------------------------------------------------
// Printed expectations the merged engine does not reach yet. Each row asserts
// the rule outcome the card text prints, so the gap is explicit. A TODO is not
// execution evidence and never counts as a pass.
// ---------------------------------------------------------------------------
const pendingRows = [
  {
    todo: "RIFT-642: runCardScenario's objectConfig drops ObjectSnapshot.combatRole, so a scenario host can never carry the 461 attacker/defender designation",
    name: "pending printed · Wielder of Water attacking alone has +2 Might",
    canonicalCardId: wielderId,
    sourceProgram: wielderOfWater,
    program: executableView(wielderOfWater),
    scenario: {
      objects: [unit("wielder", wielderId, { might: 2, combatRole: "attacker" })],
      operations: [],
      expect: { objects: { wielder: { zone: "board", might: 4 } } },
    },
  },
  {
    todo: "RIFT-642: the static alone-count resolves controller:\"self\" against the candidate object itself, so a co-located enemy is counted as a friendly unit (CR 740.2.a)",
    name: "pending printed · Wielder of Water attacking beside an enemy unit here is still alone",
    canonicalCardId: wielderId,
    sourceProgram: wielderOfWater,
    program: executableView(wielderOfWater),
    scenario: {
      objects: [
        unit("wielder", wielderId, { might: 2, combatRole: "attacker" }),
        unit("enemy-here", undefined, { owner: "B", controller: "B", might: 3 }),
      ],
      operations: [],
      expect: { objects: { wielder: { zone: "board", might: 4 } } },
    },
  },
  {
    todo: "RIFT-642: layers/filter.ts compares LocationRef by object identity, so the bound sameLocationAs grant matches no unit (CR 053.3)",
    name: "pending printed · Windswept Hillock grants [Ganking] to units here",
    canonicalCardId: hillockId,
    sourceProgram: windsweptHillock,
    program: executableView(windsweptHillock),
    scenario: {
      objects: [
        battlefield("hillock", hillockId),
        unit("unit-here", undefined, {}),
        unit("unit-elsewhere", undefined, { location: elsewhere }),
      ],
      operations: [],
      expect: {
        objects: {
          "unit-here": { zone: "board", keywords: [{ id: "Ganking" }] },
          "unit-elsewhere": { zone: "board", keywords: [] },
        },
      },
    },
  },
  {
    todo: "RIFT-642: continuous.bonus-damage has no opcode, no layer mapping and no Damage-action consumer (CR 712-715)",
    name: "pending printed · Annie, Fiery adds 1 Bonus Damage to your spell",
    canonicalCardId: annieId,
    sourceProgram: annieFiery,
    program: executableView(annieFiery),
    scenario: {
      players: { A: { energy: 10, power: ["Fury"] } },
      objects: [
        unit("annie", annieId, { might: 4, power: ["Fury"] }),
        { id: "ray", cardId: rayId, program: hextechRay, types: ["spell"], zone: "hand", location: null, energy: 1, power: ["Fury"] },
        unit("enemy", undefined, { owner: "B", controller: "B", might: 5 }),
      ],
      answers: { "target:hextech-ray.unit-at-battlefield": ["enemy"] },
      operations: [
        { type: "play", object: "ray", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" },
      ],
      expect: { objects: { enemy: { zone: "board", damage: 4 } } },
    },
  },
  {
    todo: "RIFT-642: programs/statics.ts rejects exclude anchors and freezes sameLocationAs at bind time (CR 053.3 / 359.3.f.2)",
    name: "pending printed · Garen, Commander gives other friendly units here +1 Might",
    canonicalCardId: garenId,
    sourceProgram: garenCommander,
    program: executableView(garenCommander),
    scenario: {
      objects: [
        unit("garen", garenId, { might: 5 }),
        unit("ally-here", undefined, { might: 2 }),
        unit("enemy-here", undefined, { owner: "B", controller: "B", might: 4 }),
      ],
      operations: [],
      expect: {
        objects: {
          garen: { might: 5 },
          "ally-here": { might: 3 },
          "enemy-here": { might: 4 },
        },
      },
    },
  },
  {
    todo: "RIFT-642: the static layer overwrites an existing keyword value instead of summing the granted instance (CR 831.2)",
    name: "pending printed · Clanging Sentry adds 1 onto a Mech's existing Disarm value",
    canonicalCardId: sentryId,
    sourceProgram: clangingSentry,
    program: executableView(clangingSentry),
    scenario: {
      objects: [
        unit("sentry", sentryId, { might: 2 }),
        unit("mech", undefined, { tags: ["Mech"], keywords: [{ id: "disarm", value: 3 }] }),
      ],
      operations: [],
      expect: { objects: { mech: { zone: "board", keywords: [{ id: "disarm", value: 4 }] } } },
    },
  },
  {
    todo: "RIFT-642: the static layer overwrites an existing keyword value instead of summing the granted instance (CR 809.2)",
    name: "pending printed · Watchful Curator adds 1 onto a gear's existing Deflect value",
    canonicalCardId: curatorId,
    sourceProgram: watchfulCurator,
    program: executableView(watchfulCurator),
    scenario: {
      objects: [
        unit("curator", curatorId, { might: 4 }),
        gear("own-gear", { owner: "A", keywords: [{ id: "deflect", value: 1 }] }),
      ],
      operations: [],
      expect: { objects: { "own-gear": { zone: "board", keywords: [{ id: "deflect", value: 2 }] } } },
    },
  },
  {
    todo: "RIFT-642: no merged filter or condition path evaluates the [Deploy] qualifier, so a gear without it also satisfies the aura (CR 830.3)",
    name: "pending printed · Overloaded Traveler ignores a gear without [Deploy]",
    canonicalCardId: travelerId,
    sourceProgram: overloadedTraveler,
    program: executableView(overloadedTraveler),
    scenario: {
      objects: [
        unit("traveler", travelerId, { might: 2 }),
        gear("plain-gear", { owner: "A" }),
      ],
      operations: [],
      expect: { objects: { traveler: { zone: "board", might: 2 } } },
    },
  },
  {
    todo: "RIFT-642: a co-located opponent gear satisfies the static controller:\"self\" clause (CR 740.1.a)",
    name: "pending printed · Overloaded Traveler ignores an opponent's [Deploy] gear",
    canonicalCardId: travelerId,
    sourceProgram: overloadedTraveler,
    program: executableView(overloadedTraveler),
    scenario: {
      objects: [
        unit("traveler", travelerId, { might: 2 }),
        gear("enemy-gear", { owner: "B", controller: "B", keywords: [{ id: "deploy" }] }),
      ],
      operations: [],
      expect: { objects: { traveler: { zone: "board", might: 2 } } },
    },
  },
  {
    todo: "RIFT-642: expandProgram only expands printed/declared keywords, so a runtime-granted Vision never becomes its 817.1.b Predict trigger",
    name: "pending printed · Forecaster's granted [Vision] looks at the top card when the Mech is played",
    canonicalCardId: forecasterId,
    sourceProgram: forecaster,
    program: executableView(forecaster),
    scenario: {
      players: { A: { energy: 5 } },
      objects: [
        unit("forecaster", forecasterId, { might: 2 }),
        { id: "mech", cardId: bubbleBotId, program: bubbleBot, types: ["unit"], tags: ["Mech"], zone: "hand", location: null, might: 3, energy: 3, power: null },
        { id: "top", owner: "A", types: ["unit"], zone: "deck", location: null },
      ],
      operations: [
        { type: "play", object: "mech", player: "A" },
        { type: "pass", player: "A" },
      ],
      // 817.1.b: the granted Vision should look at the top card of the Main
      // Deck. The merged spine resolves the play but never emits the look.
      expect: { events: { includes: [{ timingPoint: "cards-looked-at" }] } },
    },
  },
  {
    todo: "RIFT-642: no static-program-to-CostPlan binding and no per-player first-play window (CR 356.4 / 356.4.a)",
    name: "pending printed · Hunters' Circle discounts the first unit played here",
    canonicalCardId: circleId,
    sourceProgram: huntersCircle,
    program: executableView(huntersCircle),
    scenario: {
      players: { A: { energy: 3 } },
      objects: [
        battlefield("circle", circleId),
        { id: "unit-card", cardId: ramhoundId, program: trustyRamhound, owner: "A", types: ["unit"], zone: "hand", location: null, might: 2, energy: 3, power: null },
        unit("ally", undefined, { might: 2 }),
      ],
      operations: [
        // 053.3: the card is played TO this Battlefield, so the discount
        // window ("they play here") actually applies to it.
        { type: "play", object: "unit-card", player: "A", location: here },
        { type: "pass", player: "A" },
      ],
      // 356.4: the first unit played here should cost 1 less, so 2 of 3 Energy.
      expect: { players: { A: { energy: 1 } } },
    },
  },
  {
    todo: "RIFT-642: continuous.cost-modification has no layer mapping, no cost consumer and no once-per-turn counter (CR 366.2 / 404.2)",
    name: "pending printed · Orianna, Mechanical Marvel discounts one gear play each turn",
    canonicalCardId: oriannaId,
    sourceProgram: oriannaMechanicalMarvel,
    program: executableView(oriannaMechanicalMarvel),
    scenario: {
      players: { A: { energy: 5, power: ["Fury"] } },
      objects: [
        unit("orianna", oriannaId, { might: 5 }),
        { id: "gear-card", cardId: orbId, program: orbOfRegret, owner: "A", types: ["gear"], zone: "hand", location: null, energy: 1, power: null },
      ],
      operations: [
        { type: "play", object: "gear-card", player: "A" },
        { type: "pass", player: "A" },
      ],
      // 404.2 / 366.2: the printed discount covers the 1 Energy and the
      // any-domain Power, so this 1-Energy gear should be free.
      expect: { players: { A: { energy: 5 } } },
    },
  },
  {
    todo: "RIFT-642: cost.modify is not consumed from a card static and the printed legend has no cost-payable zone (CR 356.2.b.1 / 415.4)",
    name: "pending printed · Starry-Eyed Songstress may exhaust herself and three units to pay 2 less",
    canonicalCardId: songstressId,
    sourceProgram: starryEyedSongstress,
    program: executableView(starryEyedSongstress),
    scenario: {
      players: { A: { energy: 3, power: ["Fury"] } },
      objects: [
        { id: "songstress", cardId: songstressId, types: ["legend"], zone: "board", location: here, might: null, energy: null, power: null },
        { id: "spell", cardId: rayId, program: hextechRay, owner: "A", types: ["spell"], zone: "hand", location: null, energy: 1, power: ["Fury"] },
        unit("unit-1", undefined, {}),
        unit("unit-2", undefined, {}),
        unit("unit-3", undefined, {}),
        unit("enemy", undefined, { owner: "B", controller: "B", might: 5 }),
      ],
      answers: { "target:hextech-ray.unit-at-battlefield": ["enemy"] },
      operations: [
        { type: "play", object: "spell", player: "A" },
        { type: "pass", player: "A" },
      ],
      // 356.2.b.1 / 415.4: paying the optional cost exhausts the legend and
      // three friendly units to reduce the spell's cost by 2 Energy.
      expect: {
        objects: {
          songstress: { exhausted: true },
          "unit-1": { exhausted: true },
          "unit-2": { exhausted: true },
          "unit-3": { exhausted: true },
        },
      },
    },
  },
  {
    todo: "RIFT-642: no cards-played-this-turn history source consumes the card's static cost modification (CR 356.4.e)",
    name: "pending printed · Battering Ram costs 1 less for each card played this turn",
    canonicalCardId: ramId,
    sourceProgram: batteringRam,
    program: executableView(batteringRam),
    scenario: {
      players: { A: { energy: 5 } },
      objects: [
        { id: "seal-1", cardId: orbId, program: orbOfRegret, owner: "A", types: ["gear"], zone: "hand", location: null, energy: 0, power: null },
        { id: "seal-2", cardId: orbId, program: orbOfRegret, owner: "A", types: ["gear"], zone: "hand", location: null, energy: 0, power: null },
        unit("ram", ramId, { zone: "hand", location: null, might: 5, energy: 5, power: null }),
      ],
      operations: [
        { type: "play", object: "seal-1", player: "A" }, { type: "pass", player: "A" },
        { type: "play", object: "seal-2", player: "A" }, { type: "pass", player: "A" },
        { type: "play", object: "ram", player: "A" }, { type: "pass", player: "A" },
      ],
      // 356.4.e: two cards were played this turn, so Battering Ram costs 5-2=3.
      expect: { players: { A: { energy: 2 } } },
    },
  },
];

/**
 * Register each row as its own test. Every row first proves the published
 * program is still judge-required with an explicit reason and keeps the
 * static|| signature, then runs its scenario through the real pipeline and
 * checks that nothing was left on the chain. `todo` rows assert the printed
 * rule outcome and are reported pending, never as a pass.
 */
const runSuite = (templateName, suiteRows) => {
  const cases = defineTemplateSuite(templateName, suiteRows);
  for (const [index, golden] of cases.entries()) {
    const row = suiteRows[index];
    const options = row.todo === undefined ? undefined : { todo: row.todo };
    test(golden.name, options, () => {
      assert.equal(row.sourceProgram.status, "judge-required", `${row.canonicalCardId} stays judge-required`);
      assert.ok(row.sourceProgram.judgeReason?.trim(), `${row.canonicalCardId} keeps an explicit judge reason`);
      assert.equal(row.sourceProgram.abilities.length, 1, `${row.canonicalCardId} keeps the static|| signature`);
      assert.equal(row.sourceProgram.abilities[0].kind, "static");
      const result = golden.run();
      assert.deepEqual(result.state.chain, []);
      row.verify?.(result);
    });
  }
};

runSuite("RIFT-642 static||", rows);
runSuite("RIFT-642 static|| boundary", boundaryRows);
runSuite("RIFT-642 static|| pending printed goldens", pendingRows);
