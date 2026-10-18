// RIFT-648 template-level golden for the twelve cards grouped under the
// structural `||` signature (ability kinds | timing points | instruction
// opcodes) by the M2 sweep.
//
// `||` is a lexical grouping, not one shared executable effect. It is an
// artifact of where the scan splits the file: in these twelve programs the
// `kind`, `at` and `op` tokens all sit above the `abilities:` key (a shared
// `const equip`, or the `combatTrigger` / `attachAbility` helpers), so a scan
// that separates at `abilities:` finds no ability kind, timing point or opcode
// at all. The group therefore mixes three unrelated shapes: an empty ability
// list (Aspirant's Climb, Buff), a bare keyword list (the eight Equip Gear
// cards) and bodies built by helper functions (Graves, Grandmaster at Arms).
// Every card keeps its own row with its own printed numbers, board and
// expectations; the file never asserts that the whole group ran.
//
// runCardScenario refuses judge-required programs, so each row feeds it a
// test-local in-memory lift of the shipped program. The shipped status of all
// twelve programs stays `judge-required`: the merged engine can drive only the
// printed-cost / target / attach slice for the Equip cards, the trigger
// lifecycle for Graves and the Finalize cost payment for Grandmaster at Arms,
// and the remaining gaps are named by each judgeReason and by the fail-closed
// boundary tests at the end of this file. The lift is an evidence probe, never a
// status promotion.
import assert from "node:assert/strict";
import test from "node:test";

import { ChainContractBlockedError } from "../../../../engine-core/dist/chain/engine.js";
import { CostPlanError } from "../../../../engine-core/dist/cost/plan-types.js";
import buffInstruction from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { defineTemplateSuite, runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { TargetSelectionError } from "../../../../engine-core/dist/target/target-plan.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const IDS = {
  aspirantsClimb: "card.hash-fcad8933f7d202b4257c42152d9db853ca4833cb50e75d63d54ab0462883e34d",
  gravesBlastingThrough: "card.hash-c2e3ab2dd48bf4cc3c4fe3b2d698e6c34817fb574f4787c66b1e3fcefc58cd77",
  boneshiver: "card.hash-fafaf203c1a2733970ae4f8f4051d2c1b16da75c5e2e637905f8fce0d6287a75",
  bootsOfSwiftness: "card.hash-a22e6e418137f242aaa2ac6403b7a752bfc243cecc9d372bc3dfc04dabced9e0",
  doransRing: "card.hash-7cdb3acf3498b65e29a03912deb195f448b78a9da466c922703fc4edda7a0512",
  grandmasterAtArms: "card.hash-9ce83a420f4ca5ab0a7f43d95f5f4a698cd4c4b8ca2b7453cfdad2c9ae9f38ef",
  hexdrinker: "card.hash-655981631747696ba307a61ac6067d55653bb1215a56106697946c14c7da3146",
  trinityForce: "card.hash-e6073f232b1dbf7483b03684f042e36bd6c5692386fa16bce43630d890454681",
  worldAtlas: "card.hash-2d067a6d3e2dbc9738ed7868ad7bea2727fdc69a8074c639e913e6360798d27c",
  buff: "card.hash-66eaa3ba7dcb5f48286af9287931a07e8311549ec5b0d9c312fce567f2d723b1",
  handHammer: "card.hash-e38beb4c962c62133ef5050acc2896b4578a668939323e65af883d81c8ada753",
  pendulumBlade: "card.hash-cf2885ca18787660c4888723a93f4322d32c6a6fcb218d79e11353307fbbe53c"
};

// The eight Gear rows share one shape, so their printed numbers live here; each
// row still carries its own canonical identity, board and expectation.
const EQUIP_GEARS = [
  { id: IDS.boneshiver, label: "Boneshiver", playEnergy: 3, might: 2, equipValue: 2, costDomain: "Body" },
  { id: IDS.bootsOfSwiftness, label: "Boots of Swiftness", playEnergy: 3, might: 2, equipValue: 1, costDomain: "Chaos" },
  { id: IDS.doransRing, label: "Doran's Ring", playEnergy: 1, might: 1, equipValue: 1, costDomain: "Chaos" },
  { id: IDS.hexdrinker, label: "Hexdrinker", playEnergy: 2, might: 1, equipValue: 1, costDomain: "Body" },
  { id: IDS.trinityForce, label: "Trinity Force", playEnergy: 4, might: 2, equipValue: 1, costDomain: "Body" },
  { id: IDS.worldAtlas, label: "World Atlas", playEnergy: 3, might: 2, equipValue: 1, costDomain: "Mind" },
  { id: IDS.handHammer, label: "Hand Hammer", playEnergy: 2, might: 1, equipValue: 1, costDomain: "Calm" },
  { id: IDS.pendulumBlade, label: "Pendulum Blade", playEnergy: 3, might: 1, equipValue: 1, costDomain: "Fury" }
];

const programFor = id => {
  const program = cardProgramsById.get(id);
  assert.ok(program, `generated card program ${id} is present`);
  return program;
};

const shipped = new Map(Object.values(IDS).map(id => [id, programFor(id)]));
const candidate = id => {
  const { judgeReason: _judgeReason, ...rest } = shipped.get(id);
  return { ...rest, status: "executable" };
};

const battlefield1 = { type: "battlefield", id: "bf-1" };
const battlefield2 = { type: "battlefield", id: "bf-2" };
const base = player => ({ type: "base", player });

/**
 * The printed "Equip [cost]" clause, read out of the program's own sourceText:
 * the rune tokens before the reminder text, in printed order.  This keeps the
 * asserted value/costDomain tied to the printed text instead of to a second
 * hand-written copy of the numbers.
 */
const printedEquipSymbols = program => {
  const printed = program.sourceText.slice(0, program.sourceText.indexOf(" ("));
  return [...printed.matchAll(/:rb_(energy_[a-z0-9]+|rune_[a-z]+):/g)].map(match => match[1]);
};

// A Gear row plays the card from hand with its printed Energy and asserts the
// full printed state of the resolved Board object plus the paid cost. The Equip
// activation itself is covered by the boundary tests at the end of this file,
// because the printed Equip cost is not payable yet.
const equipPlayRow = gear => ({
  name: `${gear.label} · playing the Gear pays its printed ${gear.playEnergy} Energy and puts it on the Board`,
  canonicalCardId: gear.id,
  program: candidate(gear.id),
  scenario: {
    players: { A: { energy: 10 } },
    objects: [
      {
        id: "gear",
        cardId: gear.id,
        types: ["gear"],
        tags: ["Equipment"],
        zone: "hand",
        energy: gear.playEnergy,
        // power: null keeps "no printed Power" distinct from an empty domain list.
        power: null,
        might: gear.might
      },
      { id: "ally", owner: "A", types: ["unit"], zone: "board", location: base("A"), might: 3 }
    ],
    operations: [{ type: "play", object: "gear", player: "A" }],
    expect: {
      objects: {
        gear: {
          zone: "board",
          owner: "A",
          controller: "A",
          location: base("A"),
          energy: gear.playEnergy,
          power: null,
          might: gear.might,
          exhausted: false,
          damage: 0,
          attachedTo: null
        }
      },
      players: { A: { energy: 10 - gear.playEnergy } },
      events: {
        includes: [
          { action: { type: "move-zone" } },
          { timingPoint: "card-played" }
        ]
      }
    }
  }
});

const rows = [
  {
    name: "Aspirant's Climb · the Victory Score battlefield carries no executable ability yet",
    canonicalCardId: IDS.aspirantsClimb,
    program: candidate(IDS.aspirantsClimb),
    scenario: {
      players: { A: { energy: 0 } },
      objects: [
        {
          id: "climb",
          cardId: IDS.aspirantsClimb,
          types: ["battlefield"],
          tags: [],
          zone: "board",
          location: battlefield1,
          // A Battlefield has no printed Energy, Power or Might; the values stay
          // null and are never rewritten to 0.
          energy: null,
          power: null,
          might: null
        }
      ],
      operations: [],
      expect: {
        // The reference kernel keeps a printed null Energy/Power but coerces a
        // null Might to its default 1 (test-kernel.ts defaultObject). The card's
        // printed might: null is asserted against the catalog in the per-card
        // golden, so this row asserts no Might value.
        objects: {
          climb: { zone: "board", types: ["battlefield"], location: battlefield1, energy: null, power: null, exhausted: false }
        },
        // No ability was declared, so the real lifecycle registers nothing and
        // the scenario produces no pipeline event of its own.
        events: { exact: [] }
      }
    }
  },
  {
    name: "Buff · the token declares no card-owned ability; the one-Buff rule lives in the engine",
    canonicalCardId: IDS.buff,
    program: candidate(IDS.buff),
    scenario: {
      players: { A: { energy: 0 } },
      objects: [
        {
          id: "buff-token",
          cardId: IDS.buff,
          types: ["token"],
          tags: ["Token"],
          zone: "board",
          location: base("A"),
          energy: null,
          power: null,
          might: null
        },
        { id: "host", owner: "A", types: ["unit"], zone: "board", location: base("A"), might: 2, buffs: 0 }
      ],
      operations: [],
      expect: {
        objects: {
          // Same reference-kernel default as Aspirant's Climb: the printed null
          // Energy/Power are preserved; Might is not asserted here.
          "buff-token": { zone: "board", types: ["token"], energy: null, power: null },
          host: { buffs: 0, damage: 0 }
        },
        events: { exact: [] }
      }
    }
  },
  {
    name: "Graves, Blasting Through · attack-declared registers the Might-scaled damage trigger on the real pipeline",
    canonicalCardId: IDS.gravesBlastingThrough,
    program: candidate(IDS.gravesBlastingThrough),
    scenario: {
      objects: [
        {
          id: "graves",
          cardId: IDS.gravesBlastingThrough,
          types: ["unit"],
          zone: "board",
          location: battlefield1,
          energy: 5,
          power: ["Body"],
          might: 4
        },
        { id: "enemy-here", owner: "B", types: ["unit"], zone: "board", location: battlefield1, might: 6 },
        { id: "enemy-elsewhere", owner: "B", types: ["unit"], zone: "board", location: battlefield2, might: 6 }
      ],
      operations: [
        { type: "trigger", timingPoint: "attack-declared", object: "graves", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" }
      ],
      expect: {
        objects: {
          graves: { zone: "board", might: 4, damage: 0, energy: 5, power: ["Body"] },
          // The "all enemy units here" body is an each-set with no merged
          // consumer, so this row claims the trigger lifecycle only; the printed
          // damage expectation stays a boundary below.
          "enemy-here": { zone: "board", damage: 0 },
          "enemy-elsewhere": { zone: "board", damage: 0 }
        },
        events: {
          includes: [
            { timingPoint: "attack-declared", object: { ref: { id: "graves" } } },
            { timingPoint: "chain-item-pending", object: { ref: { id: "graves" } } },
            { timingPoint: "chain-item-finalize", object: { ref: { id: "graves" } } },
            { timingPoint: "chain-item-resolve", object: { ref: { id: "graves" } } }
          ]
        }
      }
    }
  },
  {
    name: "Graves, Blasting Through · defense-declared is the second, independent per-combat trigger",
    canonicalCardId: IDS.gravesBlastingThrough,
    program: candidate(IDS.gravesBlastingThrough),
    scenario: {
      objects: [
        {
          id: "graves",
          cardId: IDS.gravesBlastingThrough,
          types: ["unit"],
          zone: "board",
          location: battlefield1,
          energy: 5,
          power: ["Body"],
          might: 4
        },
        { id: "enemy-here", owner: "B", types: ["unit"], zone: "board", location: battlefield1, might: 6 }
      ],
      operations: [
        { type: "trigger", timingPoint: "defense-declared", object: "graves", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" }
      ],
      expect: {
        objects: { graves: { zone: "board", damage: 0 } },
        events: {
          includes: [
            { timingPoint: "defense-declared", object: { ref: { id: "graves" } } },
            { timingPoint: "chain-item-finalize", object: { ref: { id: "graves" } } },
            { timingPoint: "chain-item-resolve", object: { ref: { id: "graves" } } }
          ]
        }
      }
    }
  },
  ...EQUIP_GEARS.map(equipPlayRow),
  {
    // CR 107.4.c puts the Champion Legend in the Legend Zone, which has no ZoneId
    // in the frozen contract, so this row hosts it on the Board: it exercises the
    // printed Finalize cost (404.1.a / 415.5) and the attach body only, exactly the
    // sub-path the per-card golden calls out. The substitution is explicit here,
    // not silent.
    name: "Grandmaster at Arms · ability 1 charges 1 Energy plus Exhaust and attaches the detached Equipment (Board-hosted probe)",
    canonicalCardId: IDS.grandmasterAtArms,
    program: candidate(IDS.grandmasterAtArms),
    scenario: {
      players: { A: { energy: 10 } },
      objects: [
        {
          id: "gm",
          cardId: IDS.grandmasterAtArms,
          types: ["legend"],
          zone: "board",
          location: base("A"),
          energy: null,
          power: null,
          might: null
        },
        {
          id: "blade",
          owner: "A",
          types: ["gear"],
          tags: ["Equipment"],
          zone: "board",
          location: base("A"),
          energy: 1,
          power: null,
          might: null,
          attachedTo: null
        },
        { id: "soldier", owner: "A", types: ["unit"], zone: "board", location: base("A"), might: 2 },
        { id: "second", owner: "A", types: ["unit"], zone: "board", location: base("A"), might: 3 }
      ],
      answers: {
        "target:grandmaster-at-arms.detached-equipment": ["blade"],
        "target:grandmaster-at-arms.unit-a": ["soldier"]
      },
      operations: [
        { type: "activate", object: "gm", player: "A", ability: 0 },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" }
      ],
      expect: {
        objects: {
          gm: { zone: "board", exhausted: true },
          blade: { zone: "board", attachedTo: { id: "soldier", zoneEntryId: 1 } },
          soldier: { zone: "board", damage: 0, attachedTo: null },
          second: { zone: "board", attachedTo: null }
        },
        players: { A: { energy: 9 } },
        events: {
          includes: [
            { timingPoint: "became-target", object: { ref: { id: "blade" } } },
            { timingPoint: "became-target", object: { ref: { id: "soldier" } } },
            { action: { type: "exhaust" } },
            { action: { type: "attach" } }
          ]
        }
      }
    }
  },
  {
    // Same Board-hosted probe as ability 1: 435.1.f / 435.4 re-attach runs through
    // the real attach action while the Legend-zone gap stays open.
    name: "Grandmaster at Arms · ability 2 charges Exhaust only and re-attaches the attached Equipment (Board-hosted probe)",
    canonicalCardId: IDS.grandmasterAtArms,
    program: candidate(IDS.grandmasterAtArms),
    scenario: {
      players: { A: { energy: 10 } },
      objects: [
        {
          id: "gm",
          cardId: IDS.grandmasterAtArms,
          types: ["legend"],
          zone: "board",
          location: base("A"),
          energy: null,
          power: null,
          might: null
        },
        {
          id: "blade",
          owner: "A",
          types: ["gear"],
          tags: ["Equipment"],
          zone: "board",
          location: base("A"),
          energy: 1,
          power: null,
          might: null,
          attachedTo: { id: "soldier", zoneEntryId: 1 }
        },
        { id: "soldier", owner: "A", types: ["unit"], zone: "board", location: base("A"), might: 2 },
        { id: "second", owner: "A", types: ["unit"], zone: "board", location: base("A"), might: 3 }
      ],
      answers: {
        "target:grandmaster-at-arms.attached-equipment": ["blade"],
        "target:grandmaster-at-arms.unit-b": ["second"]
      },
      operations: [
        { type: "activate", object: "gm", player: "A", ability: 1 },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" }
      ],
      expect: {
        objects: {
          gm: { zone: "board", exhausted: true },
          // 435.1.f / 435.4: one attach action re-attaches and moves the card.
          blade: { zone: "board", attachedTo: { id: "second", zoneEntryId: 1 } },
          soldier: { zone: "board", attachedTo: null },
          second: { zone: "board", attachedTo: null }
        },
        // Ability 2 prints only the exhaust symbol: no Energy is charged.
        players: { A: { energy: 10 } },
        events: { includes: [{ action: { type: "exhaust" } }, { action: { type: "attach" } }] }
      }
    }
  }
];

for (const templateCase of defineTemplateSuite("RIFT-648 ||", rows)) test(templateCase.name, templateCase.run);

// Every shipped program keeps its judge-required status and the scenario API
// still refuses it: the template rows above are probes, not promotions.
for (const [id, program] of shipped) {
  test(`RIFT-648 || ${id}: the shipped program stays judge-required with a concrete reason`, () => {
    assert.equal(program.status, "judge-required");
    assert.equal(typeof program.judgeReason, "string");
    assert.ok(program.judgeReason.trim().length > 0);
    assert.throws(
      () => runCardScenario(program, { objects: [], operations: [] }),
      { message: `Scenario program ${id} is judge-required` }
    );
  });
}

// ---------------------------------------------------------------------------
// Boundaries. Each one asserts the real fail-closed behaviour of the merged
// pipeline; none of them reports a printed effect the engine cannot run.
// ---------------------------------------------------------------------------

// The printed Equip cost (818.1.c) has no payment kind in cost/plan-values.ts,
// so Finalize aborts the activation instead of charging the Gear's play cost.
for (const gear of EQUIP_GEARS) {
  test(`RIFT-648 || ${gear.label}: the printed ${gear.costDomain} Equip activation fails closed on the unsupported equip payment`, () => {
    const program = shipped.get(gear.id);
    const [equipKeyword] = program.abilities;
    assert.equal(equipKeyword.kind, "keyword");
    assert.equal(equipKeyword.keyword, "equip");
    // The printed Equip clause is the authority for the numbers: `value`
    // counts its resource symbols (818.1.c) and costDomain names its Power
    // rune (135.2.e.4). Rune tokens are lowercase in the printed text
    // (:rb_rune_body:) while the declared domain is capitalized ("Body"), so
    // the rune comparison is case-insensitive.
    const printed = printedEquipSymbols(program);
    assert.equal(printed.length, gear.equipValue, `${gear.label}: printed Equip symbol count`);
    assert.deepEqual(
      printed.filter(token => token.startsWith("rune_")).map(token => token.slice(5).toLowerCase()),
      [gear.costDomain.toLowerCase()],
      `${gear.label}: printed Power rune`
    );
    assert.equal(equipKeyword.value, gear.equipValue);
    assert.equal(equipKeyword.costDomain, gear.costDomain);
    assert.throws(
      () => runCardScenario(candidate(gear.id), {
        players: { A: { energy: 10 } },
        objects: [
          {
            id: "gear",
            cardId: gear.id,
            types: ["gear"],
            tags: ["Equipment"],
            zone: "board",
            location: base("A"),
            energy: gear.playEnergy,
            power: null,
            might: gear.might
          },
          { id: "ally", owner: "A", types: ["unit"], zone: "board", location: base("A"), might: 3 }
        ],
        answers: { "target:equip-target": ["ally"] },
        operations: [{ type: "activate", object: "gear", player: "A" }]
      }),
      error => {
        assert.ok(error instanceof ChainContractBlockedError, error?.constructor?.name);
        assert.match(error.message, /Unsupported payment kind: equip/);
        return true;
      }
    );
  });

  // 818.1.b.1 / 818.1.c.2: "a unit you control" is a target restriction, so an
  // opposing unit is never a candidate and the activation cannot be finalized.
  test(`RIFT-648 || ${gear.label}: no controlled unit means no legal Equip target`, () => {
    assert.throws(
      () => runCardScenario(candidate(gear.id), {
        players: { A: { energy: 10 } },
        objects: [
          {
            id: "gear",
            cardId: gear.id,
            types: ["gear"],
            tags: ["Equipment"],
            zone: "board",
            location: base("A"),
            energy: gear.playEnergy,
            power: null,
            might: gear.might
          },
          { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: base("B"), might: 3 }
        ],
        operations: [{ type: "activate", object: "gear", player: "A" }]
      }),
      error => {
        assert.ok(error instanceof TargetSelectionError, error?.constructor?.name);
        assert.equal(error.code, "no-legal-targets");
        return true;
      }
    );
  });

  // An explicit answer that names the opposing unit is rejected by the same
  // printed restriction (355.9.b).
  test(`RIFT-648 || ${gear.label}: naming an opposing unit as the Equip target is rejected`, () => {
    assert.throws(
      () => runCardScenario(candidate(gear.id), {
        players: { A: { energy: 10 } },
        objects: [
          {
            id: "gear",
            cardId: gear.id,
            types: ["gear"],
            tags: ["Equipment"],
            zone: "board",
            location: base("A"),
            energy: gear.playEnergy,
            power: null,
            might: gear.might
          },
          { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: base("B"), might: 3 },
          { id: "ally", owner: "A", types: ["unit"], zone: "board", location: base("A"), might: 3 }
        ],
        answers: { "target:equip-target": ["enemy"] },
        operations: [{ type: "activate", object: "gear", player: "A" }]
      }),
      error => {
        assert.ok(error instanceof TargetSelectionError, error?.constructor?.name);
        assert.equal(error.code, "invalid-target-choice");
        return true;
      }
    );
  });

  // Underpaying the printed play cost aborts the play instead of entering play.
  test(`RIFT-648 || ${gear.label}: playing the Gear without enough Energy fails closed`, () => {
    assert.throws(
      () => runCardScenario(candidate(gear.id), {
        players: { A: { energy: gear.playEnergy - 1 } },
        objects: [
          {
            id: "gear",
            cardId: gear.id,
            types: ["gear"],
            tags: ["Equipment"],
            zone: "hand",
            energy: gear.playEnergy,
            power: null,
            might: gear.might
          }
        ],
        operations: [{ type: "play", object: "gear", player: "A" }]
      }),
      error => {
        assert.ok(error instanceof CostPlanError, error?.constructor?.name);
        assert.equal(error.reason, "cannot-pay-cost");
        assert.match(error.message, /insufficient Energy/);
        return true;
      }
    );
  });
}

// `filter: { self: true }` restricts the subscription to Graves itself, so an
// unrelated attack declaration collects no trigger at all.
test("RIFT-648 || Graves, Blasting Through: attack-declared on another unit does not fire the self trigger", () => {
  const result = runCardScenario(candidate(IDS.gravesBlastingThrough), {
    objects: [
      { id: "graves", cardId: IDS.gravesBlastingThrough, types: ["unit"], zone: "board", location: battlefield1, might: 4 },
      { id: "ally", owner: "A", types: ["unit"], zone: "board", location: battlefield1, might: 2 },
      { id: "enemy-here", owner: "B", types: ["unit"], zone: "board", location: battlefield1, might: 6 }
    ],
    operations: [{ type: "trigger", timingPoint: "attack-declared", object: "ally", player: "A" }]
  });
  // An unrelated attack declaration emits the timing wave and the harness'
  // cleanup, but the self-filtered subscription collects no chain item.
  assert.deepEqual(
    result.events.map(event => event.timingPoint).filter(point => point.startsWith("chain-item")),
    []
  );
  assert.deepEqual(result.state.chain, []);
  assert.equal(result.state.objects.find(object => object.ref.id === "enemy-here").damage, 0);
});

// The trigger resolves through the real chain, but effect.damage reads only a
// TargetSpec id and the each-set (`appliesTo`) descriptor has no consumer yet,
// so no damage action may be observed. Asserting the printed 4 damage here would
// report a result the engine does not produce.
test("RIFT-648 || Graves, Blasting Through: the here-set damage still has no consumer (CR 355.10.d)", () => {
  const result = runCardScenario(candidate(IDS.gravesBlastingThrough), {
    objects: [
      { id: "graves", cardId: IDS.gravesBlastingThrough, types: ["unit"], zone: "board", location: battlefield1, might: 4 },
      { id: "enemy-here", owner: "B", types: ["unit"], zone: "board", location: battlefield1, might: 6 },
      { id: "enemy-elsewhere", owner: "B", types: ["unit"], zone: "board", location: battlefield2, might: 6 }
    ],
    operations: [
      { type: "trigger", timingPoint: "attack-declared", object: "graves", player: "A" },
      { type: "pass", player: "A" },
      { type: "pass", player: "B" }
    ]
  });
  assert.equal(result.events.some(event => event.action?.type === "damage"), false);
  assert.equal(result.state.objects.find(object => object.ref.id === "enemy-here").damage, 0);
  assert.equal(result.state.objects.find(object => object.ref.id === "enemy-elsewhere").damage, 0);
  assert.equal(Object.hasOwn(result.links, "dealt"), false);
});

// A ready-and-then-exhausted source: the merged exhaustion cost cannot be paid
// a second time, for either printed ability.
test("RIFT-648 || Grandmaster at Arms: an exhausted source cannot pay either printed ability", () => {
  for (const ability of [0, 1]) {
    assert.throws(
      () => runCardScenario(candidate(IDS.grandmasterAtArms), {
        players: { A: { energy: 10 } },
        objects: [
          {
            id: "gm",
            cardId: IDS.grandmasterAtArms,
            types: ["legend"],
            zone: "board",
            location: base("A"),
            energy: null,
            power: null,
            might: null,
            exhausted: true
          },
          {
            id: "blade",
            owner: "A",
            types: ["gear"],
            tags: ["Equipment"],
            zone: "board",
            location: base("A"),
            // Ability 1 needs a detached Equipment and ability 2 an attached one;
            // both answers are supplied so the printed Exhaust cost is the only
            // thing that can fail.
            attachedTo: null,
            might: null
          },
          {
            id: "worn",
            owner: "A",
            types: ["gear"],
            tags: ["Equipment"],
            zone: "board",
            location: base("A"),
            attachedTo: { id: "soldier", zoneEntryId: 1 },
            might: null
          },
          { id: "soldier", owner: "A", types: ["unit"], zone: "board", location: base("A"), might: 2 },
          { id: "second", owner: "A", types: ["unit"], zone: "board", location: base("A"), might: 3 }
        ],
        answers: {
          "target:grandmaster-at-arms.detached-equipment": ["blade"],
          "target:grandmaster-at-arms.unit-a": ["soldier"],
          "target:grandmaster-at-arms.attached-equipment": ["worn"],
          "target:grandmaster-at-arms.unit-b": ["second"]
        },
        operations: [{ type: "activate", object: "gm", player: "A", ability }]
      }),
      error => {
        assert.ok(error instanceof CostPlanError, error?.constructor?.name);
        assert.equal(error.reason, "cannot-pay-cost");
        assert.match(error.message, /ready controlled object on the Board/);
        return true;
      }
    );
  }
});

// Ability 2 requires an already attached Equipment; a detached one is not a
// candidate, so Finalize reports the missing target instead of attaching.
test("RIFT-648 || Grandmaster at Arms: ability 2 has no legal target while the only Equipment is detached", () => {
  assert.throws(
    () => runCardScenario(candidate(IDS.grandmasterAtArms), {
      players: { A: { energy: 10 } },
      objects: [
        { id: "gm", cardId: IDS.grandmasterAtArms, types: ["legend"], zone: "board", location: base("A"), energy: null, power: null, might: null },
        { id: "blade", owner: "A", types: ["gear"], tags: ["Equipment"], zone: "board", location: base("A"), attachedTo: null, might: null },
        { id: "soldier", owner: "A", types: ["unit"], zone: "board", location: base("A"), might: 2 }
      ],
      operations: [{ type: "activate", object: "gm", player: "A", ability: 1 }]
    }),
    error => {
      assert.ok(error instanceof TargetSelectionError, error?.constructor?.name);
      assert.equal(error.code, "no-legal-targets");
      return true;
    }
  );
});

// The CardProgram declares no ability for this printed reminder, so the rule it
// restates is executed where it lives: the merged effect.buff primitive.
test("RIFT-648 || Buff: the printed one-Buff limit is the engine's (702.3.a) and it negates a second Buff", () => {
  const kernel = world().unit("unit", { buffs: 0 }).build();
  kernel.setTargets("buff-target", [kernel.ref("unit")]);
  const first = runInstruction(buffInstruction, { mode: "buff", target: "buff-target" }, { world: kernel });
  assert.equal(first.result.status, "executed");
  assert.equal(kernel.getObject("unit").buffs, 1);
  const second = runInstruction(buffInstruction, { mode: "buff", target: "buff-target" }, { world: kernel });
  assert.deepEqual(second.result, { status: "negated", reason: "skipped", events: [] });
  assert.equal(kernel.getObject("unit").buffs, 1);
});

// `once: "per-combat"` is a real pipeline lifetime: two attack declarations in
// the same combat collect the trigger once, while the separately declared
// defense trigger is a second, independent registration.
test("RIFT-648 || Graves, Blasting Through: the attack trigger is once per combat and the defense trigger is separate", () => {
  const objects = [
    { id: "graves", cardId: IDS.gravesBlastingThrough, types: ["unit"], zone: "board", location: battlefield1, might: 4 },
    { id: "enemy-here", owner: "B", types: ["unit"], zone: "board", location: battlefield1, might: 6 }
  ];
  const attackTwice = runCardScenario(candidate(IDS.gravesBlastingThrough), {
    objects,
    operations: [
      { type: "trigger", timingPoint: "attack-declared", object: "graves", player: "A" },
      { type: "trigger", timingPoint: "attack-declared", object: "graves", player: "A" }
    ]
  });
  assert.equal(attackTwice.events.filter(event => event.timingPoint === "attack-declared").length, 2);
  assert.deepEqual(attackTwice.state.chain.map(item => [item.id, item.status]), [["trigger:1", "finalized"]]);

  const attackAndDefend = runCardScenario(candidate(IDS.gravesBlastingThrough), {
    objects,
    operations: [
      { type: "trigger", timingPoint: "attack-declared", object: "graves", player: "A" },
      { type: "trigger", timingPoint: "defense-declared", object: "graves", player: "A" }
    ]
  });
  assert.deepEqual(
    attackAndDefend.state.chain.map(item => [item.id, item.status]),
    [["trigger:1", "finalized"], ["trigger:2", "finalized"]]
  );
});
