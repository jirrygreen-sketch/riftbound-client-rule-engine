// RIFT-671 / README 4.1 template-level golden for the twelve `keyword+static||`
// cards (ability kinds | timing points | instruction sequence).
//
// Every row is one card: canonical identity, its own scenario, and its own
// expectations. The scenarios run through the real generic card harness
// (RIFT-592: ProgramBinding + ChainEngine + EventPipeline), so card entry, cost
// payment, keyword expansion and layer reads all use production code paths.
//
// The harness swallows static-binding failures, so completing a scenario is NOT
// evidence that a static ability works. Each row therefore also records the
// exact outcome of expanding the published program and binding every expanded
// `static` ability through the production engine binder: either it registers or
// it fails closed with a named ProgramBindingError. All twelve published
// programs stay judge-required and nothing here lifts, rewrites or approximates
// card IR or rule semantics; rows whose printed behaviour is not reachable yet
// are TODO rows that assert the PRINTED expectation, never the current wrong
// behaviour.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { playLocations, restrictions } from "../../../../engine-core/dist/layers/rules/query.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { ProgramBindingError } from "../../../../engine-core/dist/programs/errors.js";
import { bindStaticAbility, createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const ids = {
  gearhead: "card.hash-2c09104cfceee81462b6ee602bc9183760b8851fe12ba9f8a6283f6432704cd4",
  jaxUnmatched: "card.hash-a83dac0c953bf9bfdee67886a82147cb411410a3e9967fae69b37320583c94f9",
  petriciteMonument: "card.hash-40f4f4fa670faf83d3f284bef5c9dc3ae0047668559d38ad02a7521cff81b378",
  tiannaCrownguard: "card.hash-d4d3c7fbd236daf76867733cea0af3151a9d91e178cb072e3bbb88c4391fef22",
  allayEagerAdmirer: "card.hash-bd653b8aaef730f2cda1c769f847ec6222a08a3ec41066a74de13321000d898d",
  alphaWildclaw: "card.hash-d607ab71a12af3a735123e958143ee249c28c5acdc5a7f29812a4e46de002d6f",
  jhinMeticulousKiller: "card.hash-2648cb6e37ecc2bc72c247e17fe7af8e3dc29a5758f7e6f972111de8c47ee473",
  leblancEverywhereAtOnce: "card.hash-00848bf5805bd71357bd0e72b22c97fea424a1b4d5f2cbe6dddfd9d6e709a311",
  rengarTrophyHunter: "card.hash-7af45bc5485b4630b0159d3ebb543753b28e1c439f0bdccf266c500a9d157088",
  stalkingWolf: "card.hash-e0d6dea411202c84bc9da351b6c16a63eb618c96e03be8274b3ff5babc3419f8",
  aurokGeneral: "card.hash-74533231e291deb55f594e5f04b19faf248214fac82769433d2d3387166f0bad",
  discipleOfShen: "card.hash-29466276a36ad6d31ede84a0b5f6d73cfe73590d866accc1e138b05ffecd77ca"
};

const bf1 = { type: "battlefield", id: "bf-1" };
const bf2 = { type: "battlefield", id: "bf-2" };

/** Sources stay judge-required; the test view only satisfies the harness gate. */
async function sourceFor(canonicalCardId) {
  const registry = await import("../../../dist/cards/registry.generated.js");
  const source = registry.cardProgramsById.get(canonicalCardId);
  assert.ok(source, `generated card program ${canonicalCardId} is present`);
  return { published: source, view: { ...source, status: "executable", judgeReason: undefined } };
}

function placeholderFor(canonicalCardId, types = ["unit"]) {
  return {
    ref: { id: "rift-671-source", zoneEntryId: 1 },
    cardId: canonicalCardId,
    name: "rift-671-source",
    types,
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
    isToken: false
  };
}

const sourceTypesFor = canonicalCardId => canonicalCardId === ids.petriciteMonument ? ["gear"] : ["unit"];

/**
 * Bind one declared `static` ability of the card through the production engine
 * binder and hand back the live layer engine. Blocked rows use this to state
 * the PRINTED expectation through the real query path: today the binding either
 * throws a judge-required ProgramBindingError or registers nothing that the
 * production query can read, so the expectation fails instead of silently
 * passing against wrong behaviour.
 */
function bindDeclaredStatic(row, effectKind, index = 0) {
  const placeholder = placeholderFor(row.canonicalCardId, sourceTypesFor(row.canonicalCardId));
  const binding = createProgramBinding({ cardPrograms: [row.program] });
  const abilities = binding.inspect(placeholder).abilities.filter(
    ability => ability.kind === "static" && ability.effect.kind === effectKind
  );
  assert.ok(abilities.length > index, `${row.name}: expanded program declares ${effectKind}[${index}]`);
  const { engine } = fixture({ cards: [] });
  try {
    const handle = bindStaticAbility(createEngineStaticBinder(engine), abilities[index], placeholder);
    return { engine, handle, placeholder };
  } catch (error) {
    assert.fail(`${row.name}: ${effectKind} must bind through the production binder to satisfy the printed text, but it failed closed with ${error.message}`);
  }
}

/**
 * Bind every expanded static ability through the production binder and report
 * the real outcome: either the layer effect it registered (kind, keyword, value
 * and resolved filter) or the ProgramBindingError message that kept it
 * fail-closed.
 */
function staticOutcomes(row) {
  const placeholder = placeholderFor(row.canonicalCardId, sourceTypesFor(row.canonicalCardId));
  const binding = createProgramBinding({ cardPrograms: [row.program] });
  const abilities = binding.inspect(placeholder).abilities;
  const { engine } = fixture({ cards: [] });
  const binder = createEngineStaticBinder(engine);
  const outcomes = [];
  for (const ability of abilities) {
    if (ability.kind !== "static") continue;
    const before = new Set(engine.layers.registry.list().map(entry => entry.effect.id));
    try {
      const handle = bindStaticAbility(binder, ability, placeholder);
      const added = engine.layers.registry.list().filter(entry => !before.has(entry.effect.id));
      assert.equal(added.length, 1, `${row.name}: ${ability.effect.kind} adds exactly one layer effect`);
      const registered = added[0];
      assert.ok(registered, `${row.name}: ${ability.effect.kind} registered a layer effect`);
      const effect = registered.effect.effect;
      const outcome = {
        kind: ability.effect.kind,
        registered: true,
        layer: registered.effect.layer,
        source: registered.effect.source,
        filter: registered.effect.filter,
        effectKind: effect.kind,
        ...(effect.keyword === undefined ? {} : { keyword: effect.keyword }),
        ...(effect.value === undefined ? {} : { value: effect.value }),
        ...(effect.keywords === undefined ? {} : { keywords: effect.keywords }),
        ...(effect.permissions === undefined ? {} : { permissions: effect.permissions }),
        ...(effect.mode === undefined ? {} : { mode: effect.mode }),
        ...(effect.actions === undefined ? {} : { actions: effect.actions }),
        ...(effect.appliesTo === undefined ? {} : { appliesTo: effect.appliesTo })
      };
      handle.unbind();
      assert.equal(engine.layers.registry.list().some(entry => entry.effect.id === registered.effect.id), false, `${row.name}: the probe handle unbinds`);
      outcomes.push(outcome);
    } catch (error) {
      assert.ok(error instanceof ProgramBindingError, `${ability.effect.kind} must fail closed with ProgramBindingError`);
      assert.equal(error.code, "judge-required");
      outcomes.push({ kind: ability.effect.kind, message: error.message });
    }
  }
  return outcomes;
}

/**
 * Register the expanded triggered abilities through the production lifecycle
 * path (`registerProgramTriggers` -> `EventPipeline.registerTrigger`), which is
 * also where the closed EVENT_PATTERN_TYPES vocabulary is enforced.
 */
function triggerOutcome(row) {
  const placeholder = placeholderFor(row.canonicalCardId, sourceTypesFor(row.canonicalCardId));
  const binding = createProgramBinding({ cardPrograms: [row.program] });
  const { engine } = fixture({ cards: [] });
  try {
    const registered = binding.registerProgramTriggers(engine, placeholder);
    for (const id of registered) engine.pipeline.unregisterTrigger(id);
    return { count: registered.length };
  } catch (error) {
    assert.ok(error instanceof Error);
    const name = error.name ?? "Error";
    const detail = error.detail === undefined ? "" : ` ${JSON.stringify(error.detail)}`;
    return { error: `${name}: ${String(error.message)}${detail}` };
  }
}

const rows = [
  {
    // [Accelerate] (805) + "double its base Might bonus" (137.1-137.3 / 435.1.d).
    name: "Gearhead · printed cost is paid and the card enters the Board",
    canonicalCardId: ids.gearhead,
    scenario: {
      players: { A: { energy: 6 } },
      objects: [
        { id: "gearhead", cardId: ids.gearhead, types: ["unit"], zone: "hand", energy: 5, power: null, might: 3 }
      ],
      operations: [{ type: "play", object: "gearhead", player: "A" }],
      expect: {
        objects: { gearhead: { zone: "board", energy: 5, power: null, might: 3 } },
        players: { A: { energy: 1 } },
        events: {
          sequence: [
            { timingPoint: "object-enters-chain", object: { ref: "gearhead" } },
            { timingPoint: "object-enters-board", object: { ref: "gearhead" } },
            { timingPoint: "card-played", object: { ref: "gearhead" } }
          ]
        }
      }
    },
    statics: [
      {
        kind: "continuous.might",
        layer: "arithmetic",
        registered: {
          effectKind: "continuous.might",
          mode: "add",
          filter: { objectId: "rift-671-source", zone: "board", zoneEntryId: 1 }
        }
      },
      { kind: "accelerate.cost", error: /has no layer mapping/ }
    ],
    triggers: { count: 0 }
  },
  {
    name: "Gearhead · Accelerate boundary: the unpaid optional cost still enters ready",
    canonicalCardId: ids.gearhead,
    blocked:
      "CR 805.1.b/805.6: the paid [1][Mind] must be what makes the unit enter ready — the printed unit enters " +
      "exhausted when the cost is declined, but the merged replacement is registered without the payment " +
      "condition and Finalize never collects accelerate.cost",
    scenario: {
      players: { A: { energy: 6 } },
      objects: [
        { id: "gearhead", cardId: ids.gearhead, types: ["unit"], zone: "hand", energy: 5, power: null, might: 3 }
      ],
      operations: [
        { type: "play", object: "gearhead", player: "A" },
        // Explicitly decline the optional [1][Mind] additional cost (805.1.b).
        { type: "choose", id: "optional", value: false }
      ],
      expect: {
        objects: { gearhead: { zone: "board", exhausted: true } },
        players: { A: { energy: 1 } }
      }
    },
    statics: [
      {
        kind: "continuous.might",
        layer: "arithmetic",
        registered: {
          effectKind: "continuous.might",
          mode: "add",
          filter: { objectId: "rift-671-source", zone: "board", zoneEntryId: 1 }
        }
      },
      { kind: "accelerate.cost", error: /has no layer mapping/ }
    ],
    triggers: { count: 0 }
  },
  {
    // [Deflect] (809) + 819 Quick-Draw grant to Equipment in hand.
    name: "Jax, Unmatched · the grant adds Quick-Draw to an Equipment in hand only",
    canonicalCardId: ids.jaxUnmatched,
    scenario: {
      players: { A: { energy: 6, power: ["Calm"] } },
      objects: [
        { id: "jax", cardId: ids.jaxUnmatched, types: ["unit"], zone: "hand", energy: 5, power: ["Calm"], might: 5 },
        { id: "equipment", types: ["gear"], tags: ["Equipment"], zone: "hand", energy: 1, power: [] },
        { id: "plain-gear", types: ["gear"], zone: "hand", energy: 1, power: [] },
        { id: "equipment-spell", types: ["spell"], tags: ["Equipment"], zone: "hand", energy: 1, power: [] },
        { id: "board-equipment", types: ["gear"], tags: ["Equipment"], zone: "board", location: bf1, energy: 1, power: [] }
      ],
      operations: [{ type: "play", object: "jax", player: "A" }],
      expect: {
        objects: {
          jax: { zone: "board", might: 5 },
          equipment: { zone: "hand", keywords: [{ id: "quick-draw" }] },
          // 150.1/150.5: Equipment is the Gear tag, so a plain Gear, an
          // Equipment-tagged spell and a Board Gear are the scope boundary.
          "plain-gear": { zone: "hand", keywords: [] },
          "equipment-spell": { zone: "hand", keywords: [] },
          "board-equipment": { keywords: [] }
        },
        players: { A: { energy: 1 } }
      }
    },
    statics: [
      {
        kind: "continuous.grant-keyword",
        layer: "ability",
        registered: {
          effectKind: "continuous.grant-keyword",
          keyword: "quick-draw",
          filter: { zone: "hand", type: "gear", tags: ["Equipment"], controller: "A" }
        }
      },
      { kind: "target.tax", error: /has no layer mapping/ }
    ],
    triggers: { count: 0 }
  },
  {
    name: "Jax, Unmatched · boundary: no Equipment in hand means the grant reaches nothing",
    canonicalCardId: ids.jaxUnmatched,
    scenario: {
      players: { A: { energy: 6, power: ["Calm"] } },
      objects: [
        { id: "jax", cardId: ids.jaxUnmatched, types: ["unit"], zone: "hand", energy: 5, power: ["Calm"], might: 5 },
        { id: "plain-gear", types: ["gear"], zone: "hand", energy: 1, power: [] },
        { id: "equipment-spell", types: ["spell"], tags: ["Equipment"], zone: "hand", energy: 1, power: [] }
      ],
      operations: [{ type: "play", object: "jax", player: "A" }],
      expect: {
        objects: {
          jax: { zone: "board" },
          "plain-gear": { zone: "hand", keywords: [] },
          "equipment-spell": { zone: "hand", keywords: [] }
        }
      }
    },
    statics: [
      {
        kind: "continuous.grant-keyword",
        layer: "ability",
        registered: {
          effectKind: "continuous.grant-keyword",
          keyword: "quick-draw",
          filter: { zone: "hand", type: "gear", tags: ["Equipment"], controller: "A" }
        }
      },
      { kind: "target.tax", error: /has no layer mapping/ }
    ],
    triggers: { count: 0 }
  },
  {
    // [Temporary] (816) + "Friendly units have [Deflect]" (364.1/364.2, 809.1.b.3).
    name: "Petricite Monument · friendly Board units gain Deflect 1 while enemies do not",
    canonicalCardId: ids.petriciteMonument,
    scenario: {
      players: { A: { energy: 3 } },
      objects: [
        { id: "monument", cardId: ids.petriciteMonument, types: ["gear"], zone: "hand", energy: 2, power: null, might: null },
        { id: "ally", types: ["unit"], zone: "board", location: bf1, might: 2 },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: bf1, might: 2 }
      ],
      operations: [{ type: "play", object: "monument", player: "A" }],
      expect: {
        objects: {
          monument: { zone: "board", energy: 2, power: null },
          ally: { keywords: [{ id: "deflect", value: 1 }] },
          enemy: { keywords: [] }
        },
        players: { A: { energy: 1 } }
      }
    },
    statics: [{ kind: "continuous.grant-keyword" }],
    // 816.1.b: the printed [Temporary] trigger cannot be registered yet — the
    // keyword expands to `beginning-start`, which TriggerSpec's closed
    // EVENT_PATTERN_TYPES vocabulary rejects (the message lists the vocabulary)
    // and the turn flow never emits that timing point with an object payload.
    triggers: { error: /TriggerSpecValidationError: trigger\.filter\.event/ }
  },
  {
    name: "Petricite Monument · boundary: an enemy-only Board leaves the grant with no recipient",
    canonicalCardId: ids.petriciteMonument,
    scenario: {
      objects: [
        { id: "monument", cardId: ids.petriciteMonument, types: ["gear"], zone: "board", location: bf1, energy: 2, power: null, might: null },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: bf1, might: 2 }
      ],
      expect: { objects: { enemy: { keywords: [] } } }
    },
    statics: [{ kind: "continuous.grant-keyword" }],
    triggers: { error: /TriggerSpecValidationError: trigger\.filter\.event/ }
  },
  {
    // [Deflect] (809) + "While I'm at a battlefield, opponents can't score points" (470/471/363.2.a).
    name: "Tianna Crownguard · printed cost is paid and the unit enters the Board",
    canonicalCardId: ids.tiannaCrownguard,
    scenario: {
      players: { A: { energy: 7, power: ["Calm", "Calm"] } },
      objects: [
        { id: "tianna", cardId: ids.tiannaCrownguard, types: ["unit"], zone: "hand", energy: 7, power: ["Calm"], might: 4 }
      ],
      operations: [{ type: "play", object: "tianna", player: "A" }],
      expect: {
        objects: { tianna: { zone: "board", energy: 7, power: ["Calm"], might: 4 } },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "card-played", object: { ref: "tianna" } }] }
      }
    },
    statics: [
      { kind: "continuous.restrict", error: /Unsupported static appliesTo "opponents"/ },
      { kind: "target.tax", error: /has no layer mapping/ }
    ],
    triggers: { count: 0 }
  },
  {
    name: "Tianna Crownguard · boundary: the anti-score prohibition never reaches the scoring flow",
    canonicalCardId: ids.tiannaCrownguard,
    blocked:
      "CR 470/471 + 809.1.c.1: the printed prohibition must register for the Scoring action and read back through " +
      "layers/rules query; today the binder rejects appliesTo:'opponents' and no scoring-side consumer exists",
    scenario: {
      players: { A: { score: 0 }, B: { score: 0 } },
      objects: [
        { id: "tianna", cardId: ids.tiannaCrownguard, types: ["unit"], zone: "board", location: bf1, energy: 7, power: ["Calm"], might: 4 }
      ],
      expect: { players: { B: { score: 0 } } }
    },
    verify: (row) => {
      // The printed rule must be live in the production rule queries; binding it
      // is the first step and is exactly what the gap blocks.
      const { engine, placeholder, handle } = bindDeclaredStatic(row, "continuous.restrict");
      try {
        const entries = restrictions(engine.layers.registry, "score", placeholder.ref, placeholder, "B");
        assert.ok(entries.length > 0, "the printed anti-score prohibition is registered for Scoring");
      } finally {
        handle.unbind();
      }
    },
    statics: [
      { kind: "continuous.restrict", error: /Unsupported static appliesTo "opponents"/ },
      { kind: "target.tax", error: /has no layer mapping/ }
    ],
    triggers: { count: 0 }
  },
  {
    // [Deflect] (809) + "While I'm at a battlefield, your other units here have [Deflect]".
    name: "Allay, Eager Admirer · printed cost is paid and the unit enters the Board",
    canonicalCardId: ids.allayEagerAdmirer,
    scenario: {
      players: { A: { energy: 4 } },
      objects: [
        { id: "allay", cardId: ids.allayEagerAdmirer, types: ["unit"], zone: "hand", energy: 3, power: null, might: 3 },
        { id: "here-ally", types: ["unit"], zone: "board", location: bf1, might: 2 },
        { id: "away-ally", types: ["unit"], zone: "board", location: bf2, might: 2 },
        { id: "enemy-here", owner: "B", types: ["unit"], zone: "board", location: bf1, might: 2 }
      ],
      operations: [{ type: "play", object: "allay", player: "A", location: bf1 }],
      expect: {
        objects: { allay: { zone: "board", location: bf1, energy: 3, power: null, might: 3 } },
        players: { A: { energy: 1 } },
        events: { includes: [{ timingPoint: "card-played", object: { ref: "allay" } }] }
      }
    },
    statics: [
      { kind: "continuous.grant-keyword", error: /exclude anchor needs a dynamic relative filter/ },
      { kind: "target.tax", error: /has no layer mapping/ }
    ],
    triggers: { count: 0 }
  },
  {
    name: "Allay, Eager Admirer · boundary: same-location other friendly units still receive no Deflect",
    canonicalCardId: ids.allayEagerAdmirer,
    blocked:
      "CR 364.1/364.2 + 809.1.b.3: the printed aura must be registered by the production binder and grant " +
      "Deflect 1 to the other friendly units at Allay's location; today the binder rejects exclude:'self' and " +
      "the bound sameLocationAs anchor is never compared by the layer matcher",
    scenario: {
      objects: [
        { id: "allay", cardId: ids.allayEagerAdmirer, types: ["unit"], zone: "board", location: bf1, energy: 3, power: null, might: 3 },
        { id: "here-ally", types: ["unit"], zone: "board", location: bf1, might: 2 },
        { id: "away-ally", types: ["unit"], zone: "board", location: bf2, might: 2 }
      ],
      expect: {
        objects: {
          "here-ally": { keywords: [{ id: "deflect", value: 1 }] },
          "away-ally": { keywords: [] }
        }
      }
    },
    verify: (row) => {
      // 364.1/364.2: the aura has to reach the layer engine as a live grant.
      const { engine, placeholder, handle } = bindDeclaredStatic(row, "continuous.grant-keyword");
      try {
        const registered = engine.layers.registry.list();
        assert.equal(registered.length, 1, "the printed aura registers exactly one layer effect");
        assert.deepEqual(registered[0].effect.filter, {
          type: "unit",
          controller: placeholder.controller,
          zone: "board",
          location: placeholder.location
        });
      } finally {
        handle.unbind();
      }
    },
    statics: [
      { kind: "continuous.grant-keyword", error: /exclude anchor needs a dynamic relative filter/ },
      { kind: "target.tax", error: /has no layer mapping/ }
    ],
    triggers: { count: 0 }
  },
  {
    name: "Allay, Eager Admirer · boundary: at the Base the printed condition is false for every unit",
    canonicalCardId: ids.allayEagerAdmirer,
    scenario: {
      objects: [
        { id: "allay", cardId: ids.allayEagerAdmirer, types: ["unit"], zone: "board", location: { type: "base", player: "A" }, energy: 3, power: null, might: 3 },
        { id: "here-ally", types: ["unit"], zone: "board", location: bf1, might: 2 }
      ],
      expect: {
        objects: { allay: { location: { type: "base", player: "A" } }, "here-ally": { keywords: [] } }
      }
    },
    statics: [
      { kind: "continuous.grant-keyword", error: /exclude anchor needs a dynamic relative filter/ },
      { kind: "target.tax", error: /has no layer mapping/ }
    ],
    triggers: { count: 0 }
  },
  {
    // [Tank] (815) + Untargetable (756/757/757.1/758).
    name: "Alpha Wildclaw · printed cost is paid and the unit enters the Board",
    canonicalCardId: ids.alphaWildclaw,
    scenario: {
      players: { A: { energy: 6, power: ["Calm", "Calm"] } },
      objects: [
        { id: "alpha", cardId: ids.alphaWildclaw, types: ["unit"], zone: "hand", energy: 6, power: ["Calm"], might: 7 }
      ],
      operations: [{ type: "play", object: "alpha", player: "A" }],
      expect: {
        objects: { alpha: { zone: "board", energy: 6, power: ["Calm"], might: 7 } },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "card-played", object: { ref: "alpha" } }] }
      }
    },
    statics: [
      { kind: "continuous.restrict", error: /Unsupported static appliesTo "spells-and-abilities"/ },
      { kind: "continuous.combat" }
    ],
    triggers: { count: 0 }
  },
  {
    name: "Alpha Wildclaw · boundary: a weaker friendly unit here is still a legal target",
    canonicalCardId: ids.alphaWildclaw,
    blocked:
      "CR 355.9.b/757.1/758: the printed Untargetable must make weaker friendly units here illegal for enemy " +
      "spells and abilities — the source-relative 'less Might than me' predicate (mightLt) is rejected by the " +
      "static binder and target legality has no Untargetable consumer",
    scenario: {
      objects: [
        { id: "alpha", cardId: ids.alphaWildclaw, types: ["unit"], zone: "board", location: bf1, energy: 6, power: ["Calm"], might: 7 },
        { id: "weaker-ally", types: ["unit"], zone: "board", location: bf1, might: 3 },
        { id: "stronger-ally", types: ["unit"], zone: "board", location: bf1, might: 8 },
        { id: "away-ally", types: ["unit"], zone: "board", location: bf2, might: 3 }
      ],
      expect: {
        objects: {
          "weaker-ally": { keywords: [] },
          "stronger-ally": { keywords: [] },
          "away-ally": { keywords: [] }
        }
      }
    },
    verify: (row) => {
      // 757/758: the restriction must be live in the production rule query for
      // target selection, which is the step the printed text needs.
      const { engine, placeholder, handle } = bindDeclaredStatic(row, "continuous.restrict");
      try {
        const entries = restrictions(engine.layers.registry, "choose-as-target", placeholder.ref, placeholder, "B");
        assert.equal(entries.length > 0, true, "the printed Untargetable restriction is queryable");
      } finally {
        handle.unbind();
      }
    },
    statics: [
      { kind: "continuous.restrict", error: /Unsupported static appliesTo "spells-and-abilities"/ },
      { kind: "continuous.combat" }
    ],
    triggers: { count: 0 }
  },
  {
    // [Vision] (817) + the 356.1.a alternate cost.
    name: "Jhin, Meticulous Killer · condition unmet: the printed 4 Energy is paid",
    canonicalCardId: ids.jhinMeticulousKiller,
    scenario: {
      players: { A: { energy: 4 } },
      objects: [
        { id: "jhin", cardId: ids.jhinMeticulousKiller, types: ["unit"], zone: "hand", energy: 4, power: null, might: 4 }
      ],
      operations: [{ type: "play", object: "jhin", player: "A" }],
      expect: {
        objects: { jhin: { zone: "board", energy: 4, power: null, might: 4 } },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "card-played", object: { ref: "jhin" } }] }
      }
    },
    statics: [{ kind: "play-for-alternate-cost", error: /has no layer mapping/ }],
    // 817.1.c: the Vision trigger filter is rejected before registration.
    triggers: { error: /Unsupported filter field object\.id/ }
  },
  {
    name: "Jhin, Meticulous Killer · the 1 Mind Power alternate cost cannot play a 4 Energy card",
    canonicalCardId: ids.jhinMeticulousKiller,
    blocked:
      "CR 356.1.a: no CardProgram -> CostPlan consumer reads play-for-alternate-cost, so the printed 4 Energy remains due",
    scenario: {
      players: { A: { energy: 0, power: ["Mind"] } },
      objects: [
        { id: "jhin", cardId: ids.jhinMeticulousKiller, types: ["unit"], zone: "hand", energy: 4, power: null, might: 4 }
      ],
      operations: [{ type: "play", object: "jhin", player: "A" }],
      expect: { objects: { jhin: { zone: "board" } } }
    },
    statics: [{ kind: "play-for-alternate-cost", error: /has no layer mapping/ }],
    triggers: { error: /Unsupported filter field object\.id/ }
  },
  {
    name: "Jhin, Meticulous Killer · boundary: Vision does not inspect on play",
    canonicalCardId: ids.jhinMeticulousKiller,
    blocked:
      "CR 817.1.b/437.1: the printed [Vision] must Predict on play — look at the top card of the deck and let its " +
      "controller decide whether to recycle it; registerProgramTriggers currently rejects the Vision filter",
    scenario: {
      players: { A: { energy: 4 } },
      objects: [
        { id: "jhin", cardId: ids.jhinMeticulousKiller, types: ["unit"], zone: "hand", energy: 4, power: null, might: 4 },
        { id: "top", owner: "A", types: ["unit"], zone: "deck" }
      ],
      operations: [{ type: "play", object: "jhin", player: "A" }],
      // 437.1: the Predict look must happen; declining the recycle leaves the
      // card on top. The event vocabulary spells the look `cards-looked-at`.
      expect: { objects: { top: { zone: "deck" } }, events: { includes: [{ timingPoint: "cards-looked-at" }] } }
    },
    statics: [{ kind: "play-for-alternate-cost", error: /has no layer mapping/ }],
    triggers: { error: /Unsupported filter field object\.id/ }
  },
  {
    // [Backline] (826) + the [Temporary] suppression.
    name: "LeBlanc, Everywhere at Once · printed cost is paid and the unit enters the Board",
    canonicalCardId: ids.leblancEverywhereAtOnce,
    scenario: {
      players: { A: { energy: 4 } },
      objects: [
        { id: "leblanc", cardId: ids.leblancEverywhereAtOnce, types: ["unit"], zone: "hand", energy: 4, power: null, might: 4 }
      ],
      operations: [{ type: "play", object: "leblanc", player: "A" }],
      expect: {
        objects: { leblanc: { zone: "board", energy: 4, power: null, might: 4 } },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "card-played", object: { ref: "leblanc" } }] }
      }
    },
    statics: [
      { kind: "continuous.trigger-suppression", error: /Unsupported static appliesTo/ },
      { kind: "continuous.combat" }
    ],
    triggers: { count: 0 }
  },
  {
    name: "LeBlanc, Everywhere at Once · boundary: a [Temporary] effect at her battlefield still triggers",
    canonicalCardId: ids.leblancEverywhereAtOnce,
    blocked:
      "CR 721.2/816.1.b: the printed suppression must stop your [Temporary] effects at her battlefield from " +
      "triggering — there is no collected-stage trigger suppression consumer, and beginning-start cannot be " +
      "registered",
    scenario: {
      objects: [
        { id: "leblanc", cardId: ids.leblancEverywhereAtOnce, types: ["unit"], zone: "board", location: bf1, energy: 4, power: null, might: 4 },
        { id: "temporary-gear", types: ["gear"], zone: "board", location: bf1, energy: 2, power: null, might: null, keywords: [{ id: "temporary" }] }
      ],
      operations: [{ type: "trigger", timingPoint: "beginning-start", object: "temporary-gear", player: "A" }],
      expect: { objects: { "temporary-gear": { zone: "board" } } }
    },
    verify: (row) => {
      // 721.2/816.1.b: the suppression has to reach the trigger collection
      // stage as a live declaration scoped to [Temporary] effects you control
      // at her battlefield; binding it is the first step and is what fails.
      const { engine, handle } = bindDeclaredStatic(row, "continuous.trigger-suppression");
      try {
        const [registered] = engine.layers.registry.list();
        const appliesTo = registered.effect.effect.appliesTo;
        assert.equal(appliesTo.keyword, "temporary");
        assert.equal(appliesTo.controller, "controller");
        assert.equal(appliesTo.here, true);
      } finally {
        handle.unbind();
      }
    },
    statics: [
      { kind: "continuous.trigger-suppression", error: /Unsupported static appliesTo/ },
      { kind: "continuous.combat" }
    ],
    triggers: { count: 0 }
  },
  {
    // [Ambush] (822) + the 822.1.d verb permission.
    name: "Rengar, Trophy Hunter · the printed cost is paid onto a battlefield with a friendly unit",
    canonicalCardId: ids.rengarTrophyHunter,
    scenario: {
      players: { A: { energy: 5, power: ["Body"] } },
      objects: [
        { id: "rengar", cardId: ids.rengarTrophyHunter, types: ["unit"], zone: "hand", energy: 5, power: ["Body"], might: 6 },
        { id: "ally", types: ["unit"], zone: "board", location: bf1, might: 2 }
      ],
      operations: [{ type: "play", object: "rengar", player: "A", location: bf1 }],
      expect: {
        objects: { rengar: { zone: "board", location: bf1, energy: 5, power: ["Body"], might: 6 } },
        players: { A: { energy: 0 } }
      }
    },
    statics: [
      { kind: "play-location-permission", error: /has no layer mapping/ },
      { kind: "play-location-permission", error: /has no layer mapping/ },
      { kind: "continuous.timing", error: /Unsupported static appliesTo \["card"\]/ }
    ],
    triggers: { count: 0 }
  },
  {
    name: "Rengar, Trophy Hunter · boundary: an enemy-only battlefield is still not a legal destination",
    canonicalCardId: ids.rengarTrophyHunter,
    blocked:
      "CR 822.1.d/355.2.b: the printed verb form must add 'a battlefield where there are enemy units' to this " +
      "unit's legal destinations; layers/rules playLocations() only consumes continuous.location, so the " +
      "printed play-location-permission and its enemy-occupancy predicate are never evaluated",
    scenario: {
      players: { A: { energy: 5, power: ["Body"] } },
      objects: [
        { id: "rengar", cardId: ids.rengarTrophyHunter, types: ["unit"], zone: "hand", energy: 5, power: ["Body"], might: 6 },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: bf1, might: 3 }
      ],
      operations: [{ type: "play", object: "rengar", player: "A", location: bf1 }],
      expect: { objects: { rengar: { zone: "board", location: bf1 } } }
    },
    verify: (row) => {
      // 822.1.d: the permission must read back from the production location query.
      const { engine, placeholder, handle } = bindDeclaredStatic(row, "play-location-permission");
      try {
        const view = playLocations(engine.layers.registry, placeholder.ref, placeholder, placeholder.controller);
        assert.equal(view.permissions.length > 0, true, "the printed play-location-permission is queryable");
      } finally {
        handle.unbind();
      }
    },
    statics: [
      { kind: "play-location-permission", error: /has no layer mapping/ },
      { kind: "play-location-permission", error: /has no layer mapping/ },
      { kind: "continuous.timing", error: /Unsupported static appliesTo \["card"\]/ }
    ],
    triggers: { count: 0 }
  },
  {
    // [Ambush] (822) + the 356.2.a mandatory kill cost.
    name: "Stalking Wolf · the printed cost is paid and the unit enters the Board",
    canonicalCardId: ids.stalkingWolf,
    scenario: {
      players: { A: { energy: 4, power: ["Order"] } },
      objects: [
        { id: "wolf", cardId: ids.stalkingWolf, types: ["unit"], zone: "hand", energy: 4, power: ["Order"], might: 6 },
        { id: "dog", types: ["unit"], tags: ["Dog"], zone: "board", location: bf1, might: 2 }
      ],
      operations: [{ type: "play", object: "wolf", player: "A", location: bf1 }],
      expect: {
        objects: { wolf: { zone: "board", energy: 4, power: ["Order"], might: 6 } },
        players: { A: { energy: 0 } }
      }
    },
    statics: [
      { kind: "cost.additional", error: /has no layer mapping/ },
      { kind: "play-location-permission", error: /has no layer mapping/ },
      { kind: "continuous.timing", error: /Unsupported static appliesTo \["card"\]/ }
    ],
    triggers: { count: 0 }
  },
  {
    name: "Stalking Wolf · boundary: the mandatory additional cost kills nothing",
    canonicalCardId: ids.stalkingWolf,
    blocked:
      "CR 356.2.a/356.2.a.1: playing this unit must require killing one Bird, Cat, Dog or Poro you control as a " +
      "mandatory additional cost; the printed cost.additional is not wired into Finalize, and the " +
      "Bird/Cat/Dog/Poro disjunction has no runtime tag filter (tagsAny is review data only)",
    scenario: {
      players: { A: { energy: 4, power: ["Order"] } },
      objects: [
        { id: "wolf", cardId: ids.stalkingWolf, types: ["unit"], zone: "hand", energy: 4, power: ["Order"], might: 6 },
        { id: "dog", types: ["unit"], tags: ["Dog"], zone: "board", location: bf1, might: 2 },
        { id: "poro", types: ["unit"], tags: ["Poro"], zone: "board", location: bf2, might: 1 }
      ],
      operations: [{ type: "play", object: "wolf", player: "A", location: bf1 }],
      expect: { objects: { dog: { zone: "trash" }, poro: { zone: "board" } } }
    },
    verify: (row) => {
      // 356.2.a: the mandatory cost has to be collected by the Finalize cost plan.
      const { engine, placeholder, handle } = bindDeclaredStatic(row, "cost.additional");
      try {
        const entries = engine.layers.registry.list();
        assert.equal(entries.length, 1, "the printed mandatory additional cost is registered");
      } finally {
        handle.unbind();
      }
    },
    statics: [
      { kind: "cost.additional", error: /has no layer mapping/ },
      { kind: "play-location-permission", error: /has no layer mapping/ },
      { kind: "continuous.timing", error: /Unsupported static appliesTo \["card"\]/ }
    ],
    triggers: { count: 0 }
  },
  {
    // [Empower] (827) + the 828.1.b dependent ability.
    name: "Aurok General · boundary: nothing is Empowered, so no unit is modified",
    canonicalCardId: ids.aurokGeneral,
    scenario: {
      objects: [
        { id: "aurok", cardId: ids.aurokGeneral, types: ["unit"], zone: "board", location: bf1, energy: 5, power: null, might: 5 },
        { id: "ally", types: ["unit"], zone: "board", location: bf1, might: 3 }
      ],
      expect: {
        // 828.1.b.1: the dependent ability is gated on an Empowered host; the
        // printed aura therefore applies to nothing while nothing is Empowered.
        objects: { aurok: { might: 5 }, ally: { might: 3 } }
      }
    },
    statics: [{ kind: "continuous.might", error: /Unsupported static filter field empowered/ }],
    triggers: { count: 0 }
  },
  {
    name: "Aurok General · the printed [Empower] 3 Energy + 1 Order Power activation is unavailable",
    canonicalCardId: ids.aurokGeneral,
    blocked:
      "CR 827.1.c.1: KeywordAbility has no params.cost, and translateCost rejects the expander's cost kind 'empower'",
    scenario: {
      players: { A: { energy: 3, power: ["Order"] } },
      objects: [
        { id: "aurok", cardId: ids.aurokGeneral, types: ["unit"], zone: "board", location: bf1, energy: 5, power: null, might: 5 }
      ],
      operations: [
        { type: "activate", object: "aurok", player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" }
      ],
      expect: {
        objects: { aurok: { empowered: 1, might: 5 } },
        players: { A: { energy: 0 } }
      }
    },
    statics: [{ kind: "continuous.might", error: /Unsupported static filter field empowered/ }],
    triggers: { count: 0 }
  },
  {
    // [Hidden] (811) + [Shield 3] (814) with the "exactly one other unit you control" gate.
    name: "Disciple of Shen · printed cost is paid and the unit enters the Board",
    canonicalCardId: ids.discipleOfShen,
    scenario: {
      players: { A: { energy: 2 } },
      objects: [
        { id: "disciple", cardId: ids.discipleOfShen, types: ["unit"], zone: "hand", energy: 2, power: null, might: 1 },
        { id: "ally", types: ["unit"], zone: "board", location: bf1, might: 2 }
      ],
      operations: [{ type: "play", object: "disciple", player: "A" }],
      expect: {
        objects: { disciple: { zone: "board", energy: 2, power: null, might: 1 } },
        players: { A: { energy: 0 } },
        events: { includes: [{ timingPoint: "card-played", object: { ref: "disciple" } }] }
      }
    },
    statics: [
      { kind: "continuous.grant-keyword" },
      { kind: "cost.hidden", error: /has no layer mapping/ }
    ],
    triggers: { count: 0 }
  },
  {
    name: "Disciple of Shen · boundary: two other friendly units here do not grant Shield 3",
    canonicalCardId: ids.discipleOfShen,
    // 814.1.b.3: "exactly one other unit" is false with two, so the printed
    // outcome is no Shield. This boundary is a match, not evidence that the
    // condition is evaluated — the discriminating case is the row below.
    scenario: {
      objects: [
        { id: "disciple", cardId: ids.discipleOfShen, types: ["unit"], zone: "board", location: bf1, energy: 2, power: null, might: 1 },
        { id: "ally", types: ["unit"], zone: "board", location: bf1, might: 2 },
        { id: "ally-two", types: ["unit"], zone: "board", location: bf1, might: 2 }
      ],
      expect: { objects: { disciple: { keywords: [] } } }
    },
    statics: [
      { kind: "continuous.grant-keyword" },
      { kind: "cost.hidden", error: /has no layer mapping/ }
    ],
    triggers: { count: 0 }
  },
  {
    name: "Disciple of Shen · boundary: an enemy unit here never satisfies 'unit you control'",
    canonicalCardId: ids.discipleOfShen,
    // 355.9.c / 364.2: "you control" excludes the opponent's unit, so the
    // printed outcome is again no Shield. The count gate itself remains inert
    // (see the RIFT-359 row).
    scenario: {
      objects: [
        { id: "disciple", cardId: ids.discipleOfShen, types: ["unit"], zone: "board", location: bf1, energy: 2, power: null, might: 1 },
        { id: "enemy", owner: "B", types: ["unit"], zone: "board", location: bf1, might: 2 }
      ],
      expect: { objects: { disciple: { keywords: [] }, enemy: { keywords: [] } } }
    },
    statics: [
      { kind: "continuous.grant-keyword" },
      { kind: "cost.hidden", error: /has no layer mapping/ }
    ],
    triggers: { count: 0 }
  },
  {
    name: "Disciple of Shen · exactly one other friendly unit here must grant Shield 3",
    canonicalCardId: ids.discipleOfShen,
    blocked:
      "RIFT-359: layers/filter.ts selectorMatches compares controller:'controller' literally, so the printed count is " +
      "always 0; 'self' would instead match opponents' units too and cannot stand in for 'you control'",
    scenario: {
      objects: [
        { id: "disciple", cardId: ids.discipleOfShen, types: ["unit"], zone: "board", location: bf1, energy: 2, power: null, might: 1 },
        { id: "ally", types: ["unit"], zone: "board", location: bf1, might: 2 }
      ],
      expect: { objects: { disciple: { keywords: [{ id: "shield", value: 3 }] } } }
    },
    statics: [
      { kind: "continuous.grant-keyword" },
      { kind: "cost.hidden", error: /has no layer mapping/ }
    ],
    triggers: { count: 0 }
  }
];

async function register() {
  const prepared = [];
  for (const row of rows) {
    const { published, view } = await sourceFor(row.canonicalCardId);
    prepared.push({ ...row, program: view, published });
  }
  const cases = defineTemplateSuite("RIFT-671 keyword+static", prepared);
  for (const [index, entry] of cases.entries()) {
    const row = prepared[index];
    const staticGap = row.statics.find(expected => expected.error);
    const staticError = staticGap === undefined
      ? undefined
      : staticGap.error instanceof RegExp
        ? staticGap.error.source.replaceAll("\\\\", "")
        : String(staticGap.error);
    const triggerError = row.triggers?.error instanceof RegExp
      ? row.triggers.error.source.replaceAll("\\\\", "")
      : row.triggers?.error === undefined ? undefined : String(row.triggers.error);
    const bindingGaps = [
      staticGap === undefined ? undefined : `Static ability kind ${staticGap.kind}: ${staticError}`,
      triggerError === undefined ? undefined : `trigger registration rejected: ${triggerError}`,
    ].filter(Boolean);
    const declaredGap = row.blocked
      ?? (bindingGaps.length === 0 ? undefined : bindingGaps.join("; "))
      ?? "the expanded static/trigger declaration has no merged consumer";
    test.todo(`${entry.name} — ${declaredGap}; missing the corresponding production binding or rules consumer`);
  }
}

await register();
