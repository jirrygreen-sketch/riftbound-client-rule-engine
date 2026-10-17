// RIFT-646 template-level golden for the twelve `keyword+static||` cards
// (ability kinds | timing points | instruction sequence).
//
// Each row is one independent card assertion and carries the card's own
// scenario plus its own expected state. The scenarios run through the real
// generic card harness (RIFT-592: ProgramBinding + ChainEngine + EventPipeline),
// so card entry, keyword expansion, play/cost settlement and layer reads all use
// production code paths.
//
// The harness swallows static-binding failures (lifecycle calls the binder
// without an error sink), so a scenario that merely completes is NOT evidence
// that a static ability works. Every row therefore also records the exact
// outcome of binding each expanded `static` ability through the production
// engine binder: either the ability registers, or it fails closed with a named
// reason. All twelve published programs stay `judge-required`; nothing here
// lifts, rewrites or approximates card IR.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { ProgramBindingError } from "../../../../engine-core/dist/programs/errors.js";
import { bindStaticAbility, createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const ids = {
  deadbloomPredator: "card.hash-c615c988d8b72525a349735e8c5029acbffec25179ae7427d5f8bc8aff9333b4",
  gemcraftSeer: "card.hash-636736b78f865097117f9cc183f462f662d5b234a87f487fd261ac54279875c6",
  leeSinCentered: "card.hash-98fc18fcf30d6dd0b192f1c6ea251dd6a2e6d4a439098c533f77e58a2161074f",
  noxusHopeful: "card.hash-d8fc7a6f007a594060f40601cd5a28becae060a1537ac98db24d17e8039fc452",
  saiScout: "card.hash-e036ea2d851b80d8cb04068759c6d7e06f97fbc36723f415d5823f097f14cd29",
  bannerOfConquest: "card.hash-d0b3281a9fa74bb53091f97ba42c80b0e2e28e4604f24e8ea9af80e1316c03d9",
  bushwhackTrap: "card.hash-7dc2f2b5203681ffa7df7153d6be71e334c6fc0a355cb23adba138c9dd72e338",
  kaisaRebel: "card.hash-9dec9472d1f77a1c3d9249566ca3fa89140e7b6a4efcb6fe375c4fab210d2e87",
  partyCrasher: "card.hash-51a7a5074ce15f7be681afd13ce27fd042c4566c3987a18a4e7dafdf0faadc53",
  steadfastOutrider: "card.hash-af14696b17098be6286c750ebb3baaf3aeb4e4f188d7857651be5d9e4e97e053",
  ancientWarmonger: "card.hash-3657fb1a42b929920135ba38e292bf53fa1112a145cf12bb352cd750e3b64e60",
  gearhead: "card.hash-2c09104cfceee81462b6ee602bc9183760b8851fe12ba9f8a6283f6432704cd4",
};

const bf1 = { type: "battlefield", id: "bf-1" };
const bf2 = { type: "battlefield", id: "bf-2" };
const baseA = { type: "base", player: "A" };

/** Sources stay judge-required; the test view only satisfies the harness gate. */
function sourceView(canonicalCardId) {
  const source = cardProgramsById.get(canonicalCardId);
  assert.ok(source, `generated card program ${canonicalCardId} is present`);
  assert.equal(source.status, "judge-required", "RIFT-646 does not promote these programs");
  assert.ok(source.judgeReason?.trim(), "judge-required programs keep a concrete reason");
  return { ...source, status: "executable", judgeReason: undefined };
}

const programs = new Map(Object.values(ids).map(id => [id, sourceView(id)]));
const publishedPrograms = new Map(Object.values(ids).map(id => [id, cardProgramsById.get(id)]));
const viewFor = id => programs.get(id);

/**
 * Bind every expanded static ability of one card through the production engine
 * binder and report the real outcome of each. `error` rows must fail closed
 * with a judge-required ProgramBindingError; `ok` rows must register a layer.
 */
function bindStatics(row) {
  const program = viewFor(row.canonicalCardId);
  const binding = createProgramBinding({ cardPrograms: [program] });
  const abilities = binding.inspect({
    cardId: row.canonicalCardId,
    keywords: [],
    types: ["unit"],
    tags: [],
    zone: "board",
  }).abilities;
  const engine = fixture({ cards: [] }).engine;
  const binder = createEngineStaticBinder(engine);
  const placeholder = {
    ref: { id: "rift-646-source", zoneEntryId: 1 },
    cardId: row.canonicalCardId,
    name: "rift-646-source",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: bf1,
    might: 3,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false,
  };
  const outcomes = [];
  for (const ability of abilities) {
    if (ability.kind !== "static") continue;
    try {
      const handle = bindStaticAbility(binder, ability, placeholder);
      handle.unbind();
      outcomes.push({ kind: ability.effect.kind, registered: true });
    } catch (error) {
      assert.ok(error instanceof ProgramBindingError, `${ability.effect.kind} must fail closed with ProgramBindingError`);
      assert.equal(error.code, "judge-required");
      outcomes.push({ kind: ability.effect.kind, message: error.message });
    }
  }
  return outcomes;
}

function assertStatics(row, outcomes) {
  assert.deepEqual(
    outcomes.map(outcome => outcome.kind),
    row.statics.map(entry => entry.kind),
    `${row.name}: every expanded static ability is accounted for`
  );
  for (const [index, expected] of row.statics.entries()) {
    if (expected.error !== undefined) {
      assert.match(outcomes[index].message ?? "", expected.error, `${row.name}: ${expected.kind} stays fail-closed`);
    } else {
      assert.equal(outcomes[index].registered, true, `${row.name}: ${expected.kind} is registered`);
    }
  }
}

const rows = [
  {
    // [Deflect] (809.1.c) + play-to-occupied-enemy-battlefield permission (170.11.a).
    name: "Deadbloom Predator · enters an occupied enemy battlefield but neither static registers",
    canonicalCardId: ids.deadbloomPredator,
    program: viewFor(ids.deadbloomPredator),
    scenario: {
      players: { A: { energy: 8, power: ["Body"] } },
      objects: [
        { id: "predator", cardId: ids.deadbloomPredator, types: ["unit"], zone: "hand", energy: 8, power: ["Body"], might: 8 },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: bf1, might: 2 },
      ],
      operations: [{ type: "play", object: "predator", player: "A", location: bf1 }],
      expect: {
        objects: {
          predator: { zone: "board", location: bf1 },
          enemy: { zone: "board", location: bf1, might: 2, damage: 0 },
        },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "card-played" }] },
      },
    },
    statics: [
      { kind: "play-location-permission", error: /has no layer mapping/ },
      { kind: "target.tax", error: /has no layer mapping/ },
    ],
  },
  {
    // [Vision] (817.1.b) + "Other friendly units have [Vision]" (364.3 / 817.2).
    name: "Gemcraft Seer · Vision and the other-friendly Vision grant both fail closed",
    canonicalCardId: ids.gemcraftSeer,
    program: viewFor(ids.gemcraftSeer),
    scenario: {
      objects: [
        { id: "seer", cardId: ids.gemcraftSeer, types: ["unit"], zone: "board", location: bf1, might: 3, energy: 3, power: ["Mind"] },
        { id: "ally", owner: "A", types: ["unit"], zone: "board", location: bf1, might: 2 },
        { id: "top", owner: "A", types: ["unit"], zone: "deck" },
      ],
      operations: [],
      expect: {
        objects: {
          seer: { zone: "board", keywords: [] },
          ally: { zone: "board", keywords: [], might: 2 },
          top: { zone: "deck" },
        },
        events: { exact: [] },
      },
    },
    statics: [{ kind: "continuous.grant-keyword", error: /Static exclude anchor needs a dynamic relative filter/ }],
  },
  {
    // [Accelerate] (805) + aura over other buffed friendlies here (359.3.f.2 / 478.1).
    name: "Lee Sin, Centered · buffed neighbour is untouched and both statics stay fail-closed",
    canonicalCardId: ids.leeSinCentered,
    program: viewFor(ids.leeSinCentered),
    scenario: {
      objects: [
        { id: "lee", cardId: ids.leeSinCentered, types: ["unit"], zone: "board", location: bf1, might: 6, energy: 6, power: null },
        { id: "buffed-here", owner: "A", types: ["unit"], zone: "board", location: bf1, might: 2, buffs: 1 },
        { id: "buffed-elsewhere", owner: "A", types: ["unit"], zone: "board", location: bf2, might: 2, buffs: 1 },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: bf1, might: 2, buffs: 1 },
      ],
      operations: [],
      expect: {
        objects: {
          lee: { zone: "board", might: 6, power: null },
          "buffed-here": { might: 2 },
          "buffed-elsewhere": { might: 2 },
          enemy: { might: 2 },
        },
        events: { exact: [] },
      },
    },
    statics: [
      { kind: "continuous.might", error: /Static exclude anchor needs a dynamic relative filter/ },
      { kind: "accelerate.cost", error: /has no layer mapping/ },
    ],
  },
  {
    // [Legion] (812) - "I cost 2 less" (356.4.b).
    name: "Noxus Hopeful · full printed cost is paid and both statics stay fail-closed",
    canonicalCardId: ids.noxusHopeful,
    program: viewFor(ids.noxusHopeful),
    scenario: {
      players: { A: { energy: 5 } },
      objects: [{ id: "hopeful", cardId: ids.noxusHopeful, types: ["unit"], zone: "hand", energy: 4, power: null, might: 4 }],
      operations: [{ type: "play", object: "hopeful", player: "A", location: baseA }],
      expect: {
        objects: { hopeful: { zone: "board", location: baseA, power: null, keywords: [] } },
        players: { A: { energy: 1 } },
        events: { includes: [{ timingPoint: "card-played" }] },
      },
    },
    statics: [
      { kind: "cost.modify", error: /has no layer mapping/ },
      { kind: "condition.predicate", error: /has no layer mapping/ },
    ],
  },
  {
    // [Vision] (817.1.b) + play-to-open-battlefield permission (170.11.c).
    name: "Sai Scout · open battlefield entry leaves the deck top untouched",
    canonicalCardId: ids.saiScout,
    program: viewFor(ids.saiScout),
    scenario: {
      players: { A: { energy: 6 } },
      objects: [
        { id: "scout", cardId: ids.saiScout, types: ["unit"], zone: "hand", energy: 6, power: null, might: 5 },
        { id: "top", owner: "A", types: ["unit"], zone: "deck" },
      ],
      operations: [{ type: "play", object: "scout", player: "A", location: bf1 }],
      expect: {
        objects: {
          scout: { zone: "board", location: bf1, power: null },
          top: { zone: "deck" },
        },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "card-played" }] },
      },
    },
    statics: [{ kind: "play-location-permission", error: /has no layer mapping/ }],
  },
  {
    // [Deploy] (830.1) + "Friendly units here have [Assault]" (807.1.b.3).
    name: "Banner of Conquest · grant registers yet reaches no unit at the source battlefield",
    canonicalCardId: ids.bannerOfConquest,
    program: viewFor(ids.bannerOfConquest),
    scenario: {
      players: { A: { energy: 1, power: ["Fury"] } },
      objects: [
        { id: "banner", cardId: ids.bannerOfConquest, types: ["gear"], zone: "hand", energy: 1, power: ["Fury"], might: null },
        { id: "ally", owner: "A", types: ["unit"], zone: "board", location: bf1, might: 2 },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: bf1, might: 2 },
      ],
      operations: [{ type: "play", object: "banner", player: "A", location: bf1 }],
      expect: {
        objects: {
          banner: { zone: "board", location: bf1, power: ["Fury"] },
          ally: { zone: "board", might: 2, keywords: [], damage: 0 },
          enemy: { zone: "board", might: 2, keywords: [], damage: 0 },
        },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "card-played" }] },
      },
    },
    statics: [
      { kind: "continuous.grant-keyword" },
      { kind: "continuous.location", error: /has no layer mapping/ },
    ],
  },
  {
    // [Deploy] (830.1.b) + Facedown Zone occupancy (107.3.b.1).
    name: "Bushwhack Trap · Device Unit keeps its printed null power and the Deploy half stays unmapped",
    canonicalCardId: ids.bushwhackTrap,
    program: viewFor(ids.bushwhackTrap),
    scenario: {
      players: { A: { energy: 1 } },
      objects: [{ id: "trap", cardId: ids.bushwhackTrap, types: ["unit"], tags: ["Device"], zone: "hand", energy: 1, power: null, might: null }],
      operations: [{ type: "play", object: "trap", player: "A", location: bf1 }],
      expect: {
        objects: { trap: { zone: "board", location: bf1, power: null, tags: ["Device"] } },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "card-played" }] },
      },
    },
    statics: [
      { kind: "continuous.facedown-capacity" },
      { kind: "continuous.location", error: /has no layer mapping/ },
    ],
  },
  {
    // [Disarm] (831.1.d) + conditional Reaction grant (364.3 / 813.4).
    name: "Kai'Sa, Rebel · showdown grant registers but a friendly chain spell stays Reaction-less",
    canonicalCardId: ids.kaisaRebel,
    program: viewFor(ids.kaisaRebel),
    scenario: {
      phase: "showdown",
      objects: [
        { id: "kaisa", cardId: ids.kaisaRebel, types: ["unit"], zone: "board", location: bf1, might: 5, energy: 5, power: ["Mind"] },
        { id: "spell", owner: "A", types: ["spell"], zone: "chain", energy: 1, power: ["Mind"] },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: bf1, might: 2 },
      ],
      operations: [],
      expect: {
        objects: {
          kaisa: { zone: "board", might: 5 },
          spell: { zone: "chain", keywords: [], actionTimings: [] },
          enemy: { might: 2, damage: 0 },
        },
        events: { exact: [] },
      },
    },
    statics: [{ kind: "continuous.grant-keyword" }],
  },
  {
    // [Tank] (815) + "I cost 1 less for each exhausted unit you control" (356.4.g).
    name: "Party Crasher · no discount is applied and the cost static stays fail-closed",
    canonicalCardId: ids.partyCrasher,
    program: viewFor(ids.partyCrasher),
    scenario: {
      players: { A: { energy: 9, power: ["Order"] } },
      objects: [
        { id: "crasher", cardId: ids.partyCrasher, types: ["unit"], zone: "hand", energy: 9, power: ["Order"], might: 6 },
        { id: "exhausted-ally", owner: "A", types: ["unit"], zone: "board", location: bf1, might: 2, exhausted: true },
      ],
      operations: [{ type: "play", object: "crasher", player: "A", location: baseA }],
      expect: {
        objects: {
          crasher: { zone: "board", location: baseA, power: ["Order"] },
          "exhausted-ally": { exhausted: true, might: 2 },
        },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "card-played" }] },
      },
    },
    statics: [
      { kind: "continuous.cost-modification", error: /has no layer mapping/ },
      { kind: "continuous.combat" },
    ],
  },
  {
    // [Tank] (815) + the conditional +2 Might (359.3.f.2 / 740.1).
    name: "Steadfast Outrider · aura registers but the unresolved controller placeholder leaves Might at print",
    canonicalCardId: ids.steadfastOutrider,
    program: viewFor(ids.steadfastOutrider),
    scenario: {
      objects: [
        { id: "outrider", cardId: ids.steadfastOutrider, types: ["unit"], zone: "board", location: bf1, might: 3, energy: 4, power: null },
        { id: "ally", owner: "A", types: ["unit"], zone: "board", location: bf1, might: 2 },
        { id: "gear", owner: "A", types: ["gear"], zone: "board", location: bf1, energy: 2 },
        { id: "faraway", owner: "A", types: ["unit"], zone: "board", location: bf2, might: 2 },
      ],
      operations: [],
      expect: {
        objects: {
          outrider: { zone: "board", might: 3, power: null },
          ally: { might: 2 },
          faraway: { might: 2 },
        },
        events: { exact: [] },
      },
    },
    statics: [
      { kind: "continuous.might" },
      { kind: "continuous.combat" },
    ],
  },
  {
    // [Accelerate] (805) + dynamic Assault grant (807.1.b.2).
    name: "Ancient Warmonger · grant registers with an unevaluated count and Accelerate stays unbound",
    canonicalCardId: ids.ancientWarmonger,
    program: viewFor(ids.ancientWarmonger),
    scenario: {
      players: { A: { energy: 5 } },
      objects: [
        { id: "warmonger", cardId: ids.ancientWarmonger, types: ["unit"], zone: "hand", energy: 5, power: null, might: 4 },
      ],
      operations: [{ type: "play", object: "warmonger", player: "A", location: baseA }],
      expect: {
        objects: { warmonger: { zone: "board", location: baseA, might: 4, power: null, keywords: [{ id: "assault" }] } },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "card-played" }] },
      },
    },
    statics: [
      { kind: "continuous.grant-keyword" },
      { kind: "accelerate.cost", error: /has no layer mapping/ },
    ],
  },
  {
    // [Accelerate] (805) + "double its base Might bonus" (137.1-137.3 / 435.1.d).
    name: "Gearhead · attached Equipment does not double its Might bonus and Accelerate stays unbound",
    canonicalCardId: ids.gearhead,
    program: viewFor(ids.gearhead),
    scenario: {
      players: { A: { energy: 5 } },
      objects: [
        { id: "gearhead", cardId: ids.gearhead, types: ["unit"], zone: "hand", energy: 5, power: null, might: 3 },
        { id: "equipment", owner: "A", types: ["gear"], zone: "board", location: bf1, attachedTo: "gearhead", energy: 2 },
      ],
      operations: [{ type: "play", object: "gearhead", player: "A", location: baseA }],
      expect: {
        objects: {
          gearhead: { zone: "board", location: baseA, might: 3, power: null },
          equipment: { attachedTo: "gearhead" },
        },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "card-played" }] },
      },
    },
    statics: [
      { kind: "continuous.might" },
      { kind: "accelerate.cost", error: /has no layer mapping/ },
    ],
  },
];

for (const [index, golden] of defineTemplateSuite("RIFT-646 keyword+static", rows).entries()) {
  const row = rows[index];
  test(golden.name, () => {
    const result = golden.run();
    assert.equal(
      publishedPrograms.get(row.canonicalCardId).status,
      "judge-required",
      `${row.name}: the published program stays judge-required`
    );
    const host = result.state.objects.find(object => object.cardId === row.canonicalCardId);
    assert.ok(host, `${row.name}: the scenario produced the card's own object`);
    assertStatics(row, bindStatics(row));
  });
}

// Boundaries: the printed effect must stay inert when its condition, its legal
// target set, or its negated branch does not hold. Each row asserts the real
// measured state of the merged engine for that boundary.
const boundaries = [
  {
    name: "Kai'Sa, Rebel · no enemy unit here: Disarm has no legal target",
    canonicalCardId: ids.kaisaRebel,
    program: viewFor(ids.kaisaRebel),
    scenario: {
      phase: "showdown",
      objects: [
        { id: "kaisa", cardId: ids.kaisaRebel, types: ["unit"], zone: "board", location: bf1, might: 5 },
        { id: "ally", owner: "A", types: ["unit"], zone: "board", location: bf1, might: 2 },
        { id: "enemy-elsewhere", owner: "B", types: ["unit"], zone: "board", location: bf2, might: 4 },
      ],
      operations: [],
      expect: {
        objects: {
          kaisa: { might: 5 },
          ally: { might: 2 },
          "enemy-elsewhere": { might: 4 },
        },
        events: { exact: [] },
      },
    },
    statics: [{ kind: "continuous.grant-keyword" }],
  },
  {
    name: "Ancient Warmonger · no enemy unit here: no Assault Might is applied",
    canonicalCardId: ids.ancientWarmonger,
    program: viewFor(ids.ancientWarmonger),
    scenario: {
      objects: [
        { id: "warmonger", cardId: ids.ancientWarmonger, types: ["unit"], zone: "board", location: bf1, might: 4 },
        { id: "enemy-elsewhere", owner: "B", types: ["unit"], zone: "board", location: bf2, might: 2 },
      ],
      operations: [],
      expect: {
        objects: {
          warmonger: { might: 4 },
          "enemy-elsewhere": { might: 2 },
        },
        events: { exact: [] },
      },
    },
    statics: [
      { kind: "continuous.grant-keyword" },
      { kind: "accelerate.cost", error: /has no layer mapping/ },
    ],
  },
  {
    name: "Party Crasher · no exhausted unit you control: the discount condition is false",
    canonicalCardId: ids.partyCrasher,
    program: viewFor(ids.partyCrasher),
    scenario: {
      objects: [
        { id: "crasher", cardId: ids.partyCrasher, types: ["unit"], zone: "board", location: bf1, might: 6 },
        { id: "ready-ally", owner: "A", types: ["unit"], zone: "board", location: bf1, might: 2 },
        { id: "exhausted-enemy", owner: "B", types: ["unit"], zone: "board", location: bf1, might: 2, exhausted: true },
      ],
      operations: [],
      expect: {
        objects: {
          crasher: { might: 6 },
          "ready-ally": { exhausted: false, might: 2 },
          "exhausted-enemy": { exhausted: true, might: 2 },
        },
        events: { exact: [] },
      },
    },
    statics: [
      { kind: "continuous.cost-modification", error: /has no layer mapping/ },
      { kind: "continuous.combat" },
    ],
  },
  {
    name: "Lee Sin, Centered · no buffed friendly unit here: the aura has nothing to modify",
    canonicalCardId: ids.leeSinCentered,
    program: viewFor(ids.leeSinCentered),
    scenario: {
      objects: [
        { id: "lee", cardId: ids.leeSinCentered, types: ["unit"], zone: "board", location: bf1, might: 6 },
        { id: "plain-here", owner: "A", types: ["unit"], zone: "board", location: bf1, might: 2, buffs: 0 },
        { id: "buffed-elsewhere", owner: "A", types: ["unit"], zone: "board", location: bf2, might: 2, buffs: 1 },
      ],
      operations: [],
      expect: {
        objects: {
          lee: { might: 6 },
          "plain-here": { might: 2, buffs: 0 },
          "buffed-elsewhere": { might: 2, buffs: 1 },
        },
        events: { exact: [] },
      },
    },
    statics: [
      { kind: "continuous.might", error: /Static exclude anchor needs a dynamic relative filter/ },
      { kind: "accelerate.cost", error: /has no layer mapping/ },
    ],
  },
  {
    name: "Steadfast Outrider · only one other friendly at my battlefield: below the 2-or-more gate",
    canonicalCardId: ids.steadfastOutrider,
    program: viewFor(ids.steadfastOutrider),
    scenario: {
      objects: [
        { id: "outrider", cardId: ids.steadfastOutrider, types: ["unit"], zone: "board", location: bf1, might: 3 },
        { id: "single-ally", owner: "A", types: ["unit"], zone: "board", location: bf1, might: 2 },
        { id: "gear-elsewhere", owner: "A", types: ["gear"], zone: "board", location: bf2, energy: 2 },
      ],
      operations: [],
      expect: {
        objects: {
          outrider: { might: 3 },
          "single-ally": { might: 2 },
          "gear-elsewhere": { location: bf2 },
        },
        events: { exact: [] },
      },
    },
    statics: [
      { kind: "continuous.might" },
      { kind: "continuous.combat" },
    ],
  },
  {
    name: "Noxus Hopeful · Legion unmet (no other card played this turn): the full printed cost is paid",
    canonicalCardId: ids.noxusHopeful,
    program: viewFor(ids.noxusHopeful),
    scenario: {
      players: { A: { energy: 5 } },
      objects: [{ id: "hopeful", cardId: ids.noxusHopeful, types: ["unit"], zone: "hand", energy: 4, power: null, might: 4 }],
      operations: [{ type: "play", object: "hopeful", player: "A", location: baseA }],
      expect: {
        objects: { hopeful: { zone: "board" } },
        players: { A: { energy: 1 } },
        events: { includes: [{ timingPoint: "card-played" }] },
      },
    },
    statics: [
      { kind: "cost.modify", error: /has no layer mapping/ },
      { kind: "condition.predicate", error: /has no layer mapping/ },
    ],
  },
  {
    // Negated branch: the attack timing point is really emitted, but the Disarm
    // expansion's target set is empty here (the only enemy unit sits at another
    // battlefield) and its registration is rejected anyway, so the merge must
    // not invent a target and no Might may move.
    name: "Kai'Sa, Rebel · negated branch: an emitted attack with no legal Disarm target changes nothing",
    canonicalCardId: ids.kaisaRebel,
    program: viewFor(ids.kaisaRebel),
    scenario: {
      objects: [
        { id: "kaisa", cardId: ids.kaisaRebel, types: ["unit"], zone: "board", location: bf1, might: 5 },
        { id: "ally-here", owner: "A", types: ["unit"], zone: "board", location: bf1, might: 2 },
        { id: "enemy-elsewhere", owner: "B", types: ["unit"], zone: "board", location: bf2, might: 4 },
      ],
      operations: [{ type: "trigger", timingPoint: "attack-declared", object: "kaisa", player: "A" }],
      expect: {
        objects: {
          kaisa: { might: 5 },
          "ally-here": { might: 2 },
          "enemy-elsewhere": { might: 4, damage: 0 },
        },
        events: { includes: [{ timingPoint: "attack-declared" }] },
      },
    },
    statics: [{ kind: "continuous.grant-keyword" }],
  },
];

for (const [index, golden] of defineTemplateSuite("RIFT-646 keyword+static boundary", boundaries).entries()) {
  const row = boundaries[index];
  test(golden.name, () => {
    const result = golden.run();
    assert.equal(publishedPrograms.get(row.canonicalCardId).status, "judge-required");
    assert.ok(result.state.objects.some(object => object.cardId === row.canonicalCardId));
    assertStatics(row, bindStatics(row));
  });
}
