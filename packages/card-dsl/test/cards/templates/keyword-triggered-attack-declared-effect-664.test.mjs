// RIFT-664 template-level golden: keyword + triggered|attack-declared|effect.damage.
//
// The four RIFT-664 programs share the printed signature [Keyword] + "When I
// attack, <one Deal instruction>", but each card's numbers, target scope and
// amount expression differ, so every row is an independent scenario with its
// own expectations. All four source programs stay judge-required: the merged
// engine still has no combat producer for the attack-declared timing point
// (combat/flow.ts throws combat-start-transaction), and programs/filters.ts
// rejects the printed sameLocationAs "here" anchor. Lucian, Renekton and
// Volibear additionally lack the keyword-value read, the non-target set
// damage form, and the effect.damage divide-literal unpacking respectively.
//
// To keep the execution evidence honest about the merged primitives, each
// row runs an explicit test-only slice: status executable, the card's own
// abilities, and a concrete scenario battlefield in place of the rejected
// sameLocationAs anchor. The card programs are never changed; each printed
// gap stays asserted in its own judgeReason and in the boundary tests at the
// end of this file. The rows traverse the real ProgramBinding, ChainEngine
// and EventPipeline for trigger registration, target locking and (where the
// merged primitives support it) damage resolution; no fixture settles the
// effect by hand.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite, runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { ProgramRegistry, triggerRegistrations } from "../../../../engine-core/dist/programs/index.js";
import volibearFurious from "../../../dist/cards/ogn/volibear-furious.js";
import lucianGunslinger from "../../../dist/cards/sfd/lucian-gunslinger.js";
import renektonRageFueled from "../../../dist/cards/ven/renekton-rage-fueled.js";
import rivenShattered from "../../../dist/cards/ven/riven-shattered.js";

const HERE = { type: "battlefield", id: "rift-664-here" };
const ELSEWHERE = { type: "battlefield", id: "rift-664-elsewhere" };
const ATTACK = { type: "trigger", timingPoint: "attack-declared", object: "source", player: "A" };
const RESOLVE = [{ type: "pass", player: "A" }, { type: "pass", player: "B" }];

/** The reference kernel compares controller filters literally (test-kernel.ts). */
function bindSelfController(value, player = "A") {
  if (Array.isArray(value)) return value.map(item => bindSelfController(item, player));
  if (value === null || typeof value !== "object") return value === "self" ? player : value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, bindSelfController(item, player)]));
}

/**
 * Test-only execution slice. The bindController option rebinds only the
 * reference kernel's literal "self" comparison for trigger conditions. The
 * printed sameLocationAs anchor is replaced by the row's concrete battlefield
 * and asserted to fail closed at the real binding point further below.
 */
function attackSlice(program, { bindController = false } = {}) {
  const { judgeReason: _judgeReason, ...identity } = program;
  return {
    ...identity,
    status: "executable",
    abilities: program.abilities.map(ability => {
      if (ability.kind !== "triggered") return ability;
      const trigger = bindController && ability.trigger.condition !== undefined
        ? { ...ability.trigger, condition: bindSelfController(ability.trigger.condition) }
        : ability.trigger;
      return {
        ...ability,
        trigger,
        body: ability.body.map(instruction => instruction.targets === undefined ? instruction : {
          ...instruction,
          targets: instruction.targets.map(target => {
            const { sameLocationAs: _sameLocationAs, ...filter } = target.filter;
            return { ...target, filter, location: HERE };
          })
        })
      };
    })
  };
}

function sourceObject(program, slice, overrides = {}) {
  return {
    id: "source",
    cardId: program.canonicalCardId,
    program: slice,
    types: ["unit"],
    zone: "board",
    location: HERE,
    might: 4,
    ...overrides
  };
}

function enemyUnit(id, location, overrides = {}) {
  return { id, owner: "B", types: ["unit"], zone: "board", location, might: 3, ...overrides };
}

function gearAttachedTo(id, hostId) {
  return {
    id,
    owner: "A",
    types: ["gear"],
    tags: ["Equipment"],
    zone: "board",
    location: HERE,
    attachedTo: { id: hostId, zoneEntryId: 3 }
  };
}

function runeObjects(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: "rune-" + (index + 1),
    owner: "A",
    types: ["rune"],
    zone: "rune-zone"
  }));
}

const volibearSlice = attackSlice(volibearFurious);
const lucianSlice = attackSlice(lucianGunslinger);
const renektonSlice = attackSlice(renektonRageFueled, { bindController: true });
const rivenSlice = attackSlice(rivenShattered);

const rows = [
  {
    name: "Volibear, Furious splits 5 damage among the enemy units here",
    canonicalCardId: volibearFurious.canonicalCardId,
    program: volibearSlice,
    scenario: {
      objects: [
        sourceObject(volibearFurious, volibearSlice, { might: 9 }),
        enemyUnit("enemy-big", HERE, { might: 5 }),
        enemyUnit("enemy-small", HERE, { might: 2 }),
        enemyUnit("enemy-elsewhere", ELSEWHERE, { might: 4 })
      ],
      answers: {
        "target:volibear.enemy-units-here": ["enemy-big", "enemy-small"],
        "effect.damage:divide:0": 4,
        "effect.damage:divide:1": 1
      },
      // The split damage cannot resolve yet: the merged adapter does not
      // unpack the printed divide literal (see the gap test below), so this row
      // captures what does traverse the real path - trigger registration and
      // Finalize target locking for "any number of enemy units here".
      operations: [ATTACK],
      expect: {
        objects: {
          "enemy-big": { zone: "board", damage: 0 },
          "enemy-small": { zone: "board", damage: 0 },
          "enemy-elsewhere": { zone: "board", damage: 0 }
        },
        events: {
          sequence: [
            { timingPoint: "attack-declared" },
            { timingPoint: "chain-item-pending" },
            { timingPoint: "became-target", object: { ref: { id: "enemy-big" } } },
            { timingPoint: "became-target", object: { ref: { id: "enemy-small" } } },
            { timingPoint: "chain-item-finalize" }
          ]
        }
      }
    },
    verify: result => {
      // 355.14.b: the targets are locked at Finalize, up to the printed 5.
      assert.deepEqual(
        result.state.chain[0]?.targetPlans?.[0]?.selected?.map(ref => ref.id),
        ["enemy-big", "enemy-small"]
      );
      // The other battlefield is never a legal choice for "here".
      assert.ok(!result.events.some(event => event.timingPoint === "became-target" && event.object?.ref?.id === "enemy-elsewhere"));
    }
  },
  {
    name: "Lucian, Gunslinger locks one enemy unit here but the Assault-value read stays unsupported",
    canonicalCardId: lucianGunslinger.canonicalCardId,
    program: lucianSlice,
    scenario: {
      objects: [
        sourceObject(lucianGunslinger, lucianSlice, { might: 2 }),
        enemyUnit("enemy", HERE),
        enemyUnit("enemy-elsewhere", ELSEWHERE)
      ],
      answers: { "target:lucian-gunslinger.enemy-unit-here": ["enemy"] },
      operations: [ATTACK, ...RESOLVE],
      expect: {
        objects: {
          source: { zone: "board", damage: 0 },
          enemy: { zone: "board", damage: 0 },
          "enemy-elsewhere": { zone: "board", damage: 0 }
        },
        events: {
          sequence: [
            { timingPoint: "attack-declared" },
            { timingPoint: "chain-item-pending" },
            { timingPoint: "became-target", object: { ref: { id: "enemy" } } },
            { timingPoint: "chain-item-finalize" },
            { timingPoint: "chain-item-resolve" }
          ]
        }
      }
    },
    verify: result => {
      // 807.1.b.2/807.3: the printed amount must read the Assault Value. That
      // Expr form is still missing, so the instruction fails closed
      // (MissingInformation -> ignored) instead of dealing a guessed 1.
      assert.equal(result.state.chain.length, 0);
      assert.ok(!result.events.some(event => event.timingPoint === "damage-dealt"));
      assert.deepEqual(result.links, {});
    }
  },
  {
    name: "Renekton, Rage Fueled fires with 4 runes and reaches the chain with its non-target set body",
    canonicalCardId: renektonRageFueled.canonicalCardId,
    program: renektonSlice,
    scenario: {
      players: { A: { zones: { "rune-zone": ["rune-1", "rune-2", "rune-3", "rune-4"] } } },
      objects: [
        sourceObject(renektonRageFueled, renektonSlice, { might: 6 }),
        ...runeObjects(4),
        enemyUnit("enemy", HERE),
        enemyUnit("enemy-elsewhere", ELSEWHERE)
      ],
      operations: [ATTACK],
      expect: {
        objects: {
          source: { zone: "board" },
          "rune-1": { zone: "rune-zone" },
          "rune-2": { zone: "rune-zone" },
          "rune-3": { zone: "rune-zone" },
          "rune-4": { zone: "rune-zone" },
          enemy: { zone: "board", damage: 0 },
          "enemy-elsewhere": { zone: "board", damage: 0 }
        },
        events: {
          sequence: [
            { timingPoint: "attack-declared" },
            { timingPoint: "chain-item-pending" },
            { timingPoint: "chain-item-finalize" }
          ]
        }
      }
    },
    verify: result => {
      // The 383.2.a.1 Trigger Condition is true, so the real chain holds the
      // triggered item; "deal 2 to all enemy units here" is a non-target set
      // (355.10.d) whose merged primitive form is still missing.
      assert.equal(result.state.chain.length, 1);
      assert.equal(result.state.chain[0].kind, "triggered");
      assert.equal(result.state.chain[0].status, "finalized");
    }
  },
  {
    name: "Riven, Shattered deals 2 per attached Equipment to the chosen enemy unit here",
    canonicalCardId: rivenShattered.canonicalCardId,
    program: rivenSlice,
    scenario: {
      objects: [
        sourceObject(rivenShattered, rivenSlice, { might: 3 }),
        enemyUnit("enemy", HERE, { might: 5 }),
        enemyUnit("enemy-elsewhere", ELSEWHERE, { might: 5 }),
        gearAttachedTo("sword", "source"),
        gearAttachedTo("shield", "source")
      ],
      answers: { "target:riven-shattered.enemy-unit-here": ["enemy"] },
      operations: [ATTACK, ...RESOLVE],
      expect: {
        objects: {
          source: { zone: "board", damage: 0 },
          enemy: { zone: "board", damage: 4 },
          "enemy-elsewhere": { zone: "board", damage: 0 },
          sword: { zone: "board", attachedTo: { id: "source", zoneEntryId: 3 } },
          shield: { zone: "board", attachedTo: { id: "source", zoneEntryId: 3 } }
        },
        events: {
          sequence: [
            { timingPoint: "attack-declared" },
            { timingPoint: "chain-item-pending" },
            { timingPoint: "became-target", object: { ref: { id: "enemy" } } },
            { timingPoint: "chain-item-finalize" },
            { timingPoint: "damage-dealt", action: { type: "damage", target: "enemy" } },
            { timingPoint: "chain-item-resolve" }
          ]
        },
        links: {
          "riven-shattered.damage-per-equipment.dealt": 4,
          "riven-shattered.damage-per-equipment.dealtCount": 1,
          "riven-shattered.damage-per-equipment.dealtTo": [
            { target: { id: "enemy", zoneEntryId: 1 }, amount: 4 }
          ]
        }
      }
    },
    verify: result => {
      for (const id of ["sword", "shield"]) {
        assert.deepEqual(
          result.state.objects.find(object => object.ref.id === id)?.attachedTo,
          { id: "source", zoneEntryId: 3 }
        );
      }
    }
  }
];

const cases = defineTemplateSuite("keyword + triggered|attack-declared|effect.damage / RIFT-664", rows);
for (const [index, templateCase] of cases.entries()) {
  test(templateCase.name, () => {
    const row = rows[index];
    assert.equal(row.program.canonicalCardId, row.canonicalCardId);
    assert.equal(row.program.status, "executable");
    const triggered = row.program.abilities.filter(ability => ability.kind === "triggered");
    assert.equal(triggered.length, 1);
    assert.equal(triggered[0].trigger.at, "attack-declared");
    const result = templateCase.run();
    assert.ok(result.events.length > 0, row.name + ": real pipeline events are required");
    row.verify?.(result);
  });
}

test("RIFT-664: every source program keeps judge-required and its own identity", () => {
  const sources = [volibearFurious, lucianGunslinger, renektonRageFueled, rivenShattered];
  const expected = [
    "card.hash-3945b807e4fed55c0e3bd1ea8f5f24a46e04bea3379a8e559da6db0f73a173cc",
    "card.hash-9cbd19f7b3430a1dd398620ef97b933b43283fd7e9514a877188b5aa5d1cd80a",
    "card.hash-4ea204b4fa413be39f3508c65d93d8ef270e1bb64d97edf9a216efa7d50394f4",
    "card.hash-449ee3c99ccb6cbedf40282cf1e6bd9c5f1849ff561c01da7535c34da3628b11"
  ];
  // 383.4.e has no producer yet and each card has at least one merged gap, so
  // none of the four can honestly be promoted by this template.
  assert.deepEqual(sources.map(program => program.canonicalCardId), expected);
  for (const program of sources) {
    assert.equal(program.status, "judge-required");
    assert.match(program.judgeReason, /attack-declared/);
  }
});

test("RIFT-664 boundary: the real production binding rejects the printed here anchor", () => {
  // Lift only the status gate so registration reaches the merged filter
  // translator; the printed sameLocationAs anchor itself must still fail closed.
  const lifted = { ...volibearFurious, status: "executable", judgeReason: undefined };
  const registry = new ProgramRegistry([lifted]);
  const kernel = world()
    .unit("source", { cardId: volibearFurious.canonicalCardId, location: HERE, might: 9 })
    .build();
  assert.throws(
    () => triggerRegistrations(registry, kernel.getObject("source")),
    error => error?.code === "judge-required" && /Unsupported filter field sameLocationAs/.test(error.message)
  );
});

test("RIFT-664 boundary: no legal enemy unit here drops Lucian's trigger without damage", () => {
  const result = runCardScenario(lucianSlice, {
    objects: [
      sourceObject(lucianGunslinger, lucianSlice, { might: 2 }),
      enemyUnit("enemy-elsewhere", ELSEWHERE)
    ],
    operations: [ATTACK],
    expect: {
      objects: {
        source: { zone: "board", damage: 0 },
        "enemy-elsewhere": { zone: "board", damage: 0 }
      },
      events: { includes: [{ timingPoint: "attack-declared" }] }
    }
  });
  // Finalize raises no-legal-targets for the required count (355.9.a.1), so
  // the unperformable trigger is removed and never resolves.
  assert.equal(result.state.chain.length, 0);
  assert.ok(!result.events.some(event => event.timingPoint === "chain-item-finalize"));
  assert.equal(result.state.objects.find(object => object.ref.id === "source")?.damage, 0);
});

test("RIFT-664 boundary: Riven with no attached Equipment negates the zero damage without an event", () => {
  const result = runCardScenario(rivenSlice, {
    objects: [
      sourceObject(rivenShattered, rivenSlice, { might: 3 }),
      enemyUnit("enemy", HERE, { might: 5 })
    ],
    answers: { "target:riven-shattered.enemy-unit-here": ["enemy"] },
    operations: [ATTACK, ...RESOLVE],
    expect: {
      objects: { enemy: { zone: "board", damage: 0 } },
      events: {
        sequence: [
          { timingPoint: "attack-declared" },
          { timingPoint: "chain-item-finalize" },
          { timingPoint: "chain-item-resolve" }
        ]
      }
    }
  });
  // 418.1.e.1: zero is not valid damage, so no damage event may be emitted.
  assert.ok(!result.events.some(event => event.timingPoint === "damage-dealt"));
  assert.deepEqual(result.links, {});
});

test("RIFT-664 boundary: Renekton's 4-or-fewer-runes condition is false with 5 runes", () => {
  const result = runCardScenario(renektonSlice, {
    players: { A: { zones: { "rune-zone": ["rune-1", "rune-2", "rune-3", "rune-4", "rune-5"] } } },
    objects: [
      sourceObject(renektonRageFueled, renektonSlice, { might: 6 }),
      ...runeObjects(5),
      enemyUnit("enemy", HERE)
    ],
    operations: [ATTACK],
    expect: {
      objects: {
        "rune-1": { zone: "rune-zone" },
        "rune-5": { zone: "rune-zone" },
        enemy: { zone: "board", damage: 0 }
      },
      // 383.4.e.2.b: with the condition unfulfilled at the attack
      // declaration, no Pending Item and no chain event are created.
      events: { exact: [{ timingPoint: "attack-declared" }, { timingPoint: "cleanup-start" }, { timingPoint: "cleanup-end" }] }
    }
  });
  assert.equal(result.state.chain.length, 0);
});

test("RIFT-664 gap: the printed effect.damage divide literal is not unpacked by the merged adapter", () => {
  // The card declares { kind: "literal", value: true } (355.14 split). The
  // merged chain/interpreter-adapter LITERAL_FIELDS does not list divide, so
  // the production primitive receives the Expr object and rejects it. This is
  // the remaining Volibear execution gap recorded in its judgeReason.
  const literalDivideSlice = attackSlice(volibearFurious);
  assert.throws(
    () => runCardScenario(literalDivideSlice, {
      objects: [
        sourceObject(volibearFurious, literalDivideSlice, { might: 9 }),
        enemyUnit("enemy", HERE, { might: 5 })
      ],
      answers: { "target:volibear.enemy-units-here": ["enemy"], "effect.damage:divide:0": 5 },
      operations: [ATTACK, ...RESOLVE],
      expect: {}
    }),
    /effect\.damage args\.divide must be true when present/
  );
});

test("RIFT-664 gap: Renekton's non-target set damage is rejected by the merged primitive", () => {
  // "deal 2 to all enemy units here" is a characteristic-selected set
  // (355.10.d), not a TargetSpec. The card correctly declares it as an
  // objects query; effect.damage only accepts args.target, so the production
  // resolve path fails closed. Renekton therefore stays judge-required.
  assert.throws(
    () => runCardScenario(renektonSlice, {
      players: { A: { zones: { "rune-zone": ["rune-1", "rune-2", "rune-3", "rune-4"] } } },
      objects: [
        sourceObject(renektonRageFueled, renektonSlice, { might: 6 }),
        ...runeObjects(4),
        enemyUnit("enemy", HERE)
      ],
      operations: [ATTACK, ...RESOLVE],
      expect: {}
    }),
    /effect\.damage args\.target must be a TargetSpec id string/
  );
});
