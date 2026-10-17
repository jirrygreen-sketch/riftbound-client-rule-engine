import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/rage-amplifier.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL =
  "card.hash-d253644e2551694bc909320c263dcb18818de02f076039f478f45ef0e36eff91";
const SOURCE_TEXT =
  "[Empower] :rb_energy_6::rb_rune_fury: (:rb_energy_6::rb_rune_fury:: Empower this. Use only if not Empowered.)\n" +
  "Your units have +1 :rb_might:. If I'm [Empowered], they have +2 :rb_might: instead.";

const [empower, baseMight, empoweredMight] = program.abilities;

/** A controlled unit on the Board whose Might the static effect would modify. */
function unit(id, overrides = {}) {
  return {
    ref: { id, zoneEntryId: 1 },
    cardId: "card:" + id,
    name: id,
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "base", player: "A" },
    might: 2,
    energy: 1,
    power: ["Fury"],
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false,
    ...overrides
  };
}

/**
 * The reference layer matcher compares filter values literally, so the symbolic
 * "controller": "controller" placeholder is bound to the acting player for the
 * execution check (the same convention as ven/protective-sands and
 * ogn/master-yi-meditative); the declared program keeps the placeholder.
 */
function substituteController(value, playerId) {
  if (Array.isArray(value)) return value.map(item => substituteController(item, playerId));
  if (value === null || typeof value !== "object") return value === "controller" ? playerId : value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, substituteController(item, playerId)])
  );
}

/** Register one declared static effect in the merged layer engine. */
function layeredEngine(objects, ability, id) {
  const engine = createLayerEngine(objects, [
    {
      effect: {
        id,
        layer: ability.effect.layer,
        filter: substituteController(ability.effect.filter, "A"),
        effect: ability.effect
      },
      duration: { type: "permanent" },
      timestamp: 1
    }
  ]);
  engine.setObjects(objects);
  return engine;
}

test("ven-018-166 Rage Amplifier: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-018-166 Rage Amplifier: identity, ruleset, status, judgeReason and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /828\.1\.c/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ven-018-166 Rage Amplifier: the printed Empower cost is declared as the keyword, not expanded", () => {
  assert.equal(program.abilities.length, 3);
  assert.equal(empower.kind, "keyword");
  assert.equal(empower.keyword, "empower");
  // 827.1.c: the printed cost is 6 Energy plus one Fury Power rune.
  assert.equal(empower.value, 6);
  assert.equal(empower.costDomain, "Fury");
  // 827.1.c.1's activation cost / disempower guard must come from the keyword
  // expansion; the card adds no second activated ability.
  assert.ok(program.abilities.every(ability => ability.kind !== "activated"));
});

test("ven-018-166 Rage Amplifier: +1 Might for your units, and the Empowered +2 instead branch", () => {
  // 828.1.b.1: the default branch applies while the source is not Empowered.
  assert.equal(baseMight.kind, "static");
  assert.equal(baseMight.effect.kind, "continuous.might");
  assert.equal(baseMight.effect.mode, "add");
  assert.equal(baseMight.effect.layer, "arithmetic");
  assert.deepEqual(baseMight.effect.amount, { kind: "constant", value: 1 });
  // 740.1.a: "Your units" is the ability controller's units on the Board (365.1).
  assert.deepEqual(baseMight.effect.filter, {
    type: "unit",
    controller: "controller",
    zone: "board"
  });
  assert.deepEqual(baseMight.condition, {
    kind: "not",
    condition: {
      kind: "expression",
      value: { kind: "constant", value: "self-is-empowered" }
    }
  });

  // "instead": the Empowered branch replaces the +1 with +2, it is not a
  // second, additional modification.
  assert.equal(empoweredMight.kind, "static");
  assert.equal(empoweredMight.effect.kind, "continuous.might");
  assert.deepEqual(empoweredMight.effect.amount, { kind: "constant", value: 2 });
  assert.deepEqual(empoweredMight.effect.insteadOf, {
    kind: "constant",
    value: "rage-amplifier-base-might"
  });
  assert.deepEqual(empoweredMight.condition, {
    kind: "expression",
    value: { kind: "constant", value: "self-is-empowered" }
  });
  assert.deepEqual(empoweredMight.effect.filter, baseMight.effect.filter);
});

test("ven-018-166 Rage Amplifier golden: the +1 declaration really raises a controlled unit's Might in the merged layers", () => {
  const friendly = unit("friendly-unit");
  const enemy = unit("enemy-unit", { owner: "B", controller: "B", location: { type: "base", player: "B" } });
  const engine = layeredEngine([friendly, enemy], baseMight, "rage-amplifier-base-might");

  // The merged layers arithmetic is the real path being exercised here: the
  // declared +1 is applied to the controller's unit and left off the opposing
  // unit, whose printed characteristics are untouched. The branch selection by
  // the Empowered predicate (828.1.c) is the judged part and stays a TODO.
  assert.equal(engine.evaluate(friendly.ref).might, 3);
  assert.equal(engine.evaluate(enemy.ref).might, 2);
  assert.equal(engine.evaluate(friendly.ref).printed.might, 2);
});

test("ven-018-166 Rage Amplifier golden: the Empowered branch would raise the same unit by 2 in the merged layers", () => {
  const friendly = unit("friendly-unit");
  const engine = layeredEngine([friendly], empoweredMight, "rage-amplifier-empowered-might");

  assert.equal(engine.evaluate(friendly.ref).might, 4);
});

test.todo(
  "ven-018-166 Rage Amplifier: [Empower] 6 Energy + 1 Fury Power must expand to its activation cost with the " +
    "\"use only if not Empowered\" restriction (827.1.c.1 / 442.1.b) - no Empower/Empowered KeywordDef exists " +
    "in effects/keywords/registry.generated.ts (RIFT-81~88 batch excludes them)"
);
test.todo(
  "ven-018-166 Rage Amplifier: the +1/+2 Might branches must be registered from the CardProgram's static ability " +
    "and selected by an evaluable Empowered predicate (828.1.c) - the static → layers binding entry point is merged " +
    "(programs/statics.ts createEngineStaticBinder, RIFT-91 batch) and both branches execute in the layer engine, " +
    "but the empowered predicate itself is still missing (in-flight RIFT-359 condition predicates)"
);
