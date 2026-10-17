import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/rell-magnetic.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const ID = "card.hash-27bea0f367ed3fcfb05e2db8a75852c62b0d458ec5b40b46249818322961e541";

test("sfd-024-221 Rell, Magnetic: validates identity and ability structure", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(ID), program);
  assert.equal(program.canonicalCardId, ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Tank/);
  assert.match(program.judgeReason, /effects\/keywords\/Tank\.ts/);
  assert.match(program.judgeReason, /energyLte/);
  assert.equal(program.sourceText, "[Tank] (I must be assigned combat damage first.)\nWhen I attack, you may play an Equipment with Energy cost no more than :rb_energy_2:, ignoring its cost, and attach it to me.");
});

test("sfd-024-221 Rell, Magnetic: Tank plus optional attack play", () => {
  const [tank, attack] = program.abilities;
  assert.deepEqual(tank, { kind: "keyword", keyword: "tank" });
  assert.equal(attack.trigger.at, "attack-declared");
  const optional = attack.body[0];
  assert.equal(optional.op, "choice.optional");
  const play = optional.args.body.value[0];
  assert.equal(play.op, "effect.play");
  assert.deepEqual(play.args.pick, { kind: "constant", value: "rell-magnetic.equipment" });
  assert.deepEqual(play.args.cost, { kind: "constant", value: { finalized: true, energy: 0, power: [], xp: 0 } });
  assert.deepEqual(play.picks[0].filter, { type: "gear", tag: "Equipment", zone: "hand", controller: "controller", energyLte: 2 });
  assert.equal(play.picks[0].min, 1);
  assert.equal(play.picks[0].max, 1);
});

test.todo("Rell: add Tank combat assignment, printed-cost filtering, ignored-cost planning and played-object attachment (RIFT-89/RIFT-91)");
// Direct evidence for the Tank and Equipment-play gaps recorded in the
// judgeReason: the Tank expansion's continuous.combat effect registers in the
// ability layer but the layer snapshot has no combat-damage consumer, and the
// printed energyLte cap is rejected by the filter adapter while the raw
// matcher silently ignores it.
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const [, attack] = program.abilities;
const [optional] = attack.body;
const [play] = optional.args.body.value;

test("sfd-024-221 Rell, Magnetic: the Tank expansion registers in the ability layer but no combat consumer reads it (CR 815)", () => {
  const kernel = world()
    .unit("rell", { might: 4, zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const snapshot = kernel.getObject("rell");
  const [tankExpansion] = keywordDefinitionsById.get("Tank").expand({ host: { canonicalCardId: program.canonicalCardId } });

  assert.deepEqual(tankExpansion.effect, {
    kind: "continuous.combat",
    appliesTo: "self",
    mode: "damage-assignment",
    priority: "first",
    damage: "lethal",
    controllerScope: "same-controller",
    excludesKeyword: "Tank"
  });

  // Mirror the production binding shape (programs/statics.ts bindStaticToLayers):
  // the ability layer registers the effect permanently, yet the resulting
  // snapshot exposes no damage-assignment field for combat to consume.
  const layers = createLayerEngine(kernel.objects, [{
    id: "program-static:rell:1:0",
    layer: "ability",
    source: snapshot.ref,
    filter: { objectId: "rell" },
    effect: { id: "program-static:rell:1:0", ...tankExpansion.effect, filter: { objectId: "rell" } },
    duration: { type: "permanent" },
    timestamp: 1
  }]);
  const layerSnapshot = layers.snapshot(snapshot.ref);
  assert.deepEqual(
    Object.keys(layerSnapshot).filter((key) => /damageAssignment|assignment|damage-assignment/i.test(key)),
    [],
    "the ability layer exposes no combat damage-assignment consumer"
  );
});

test("sfd-024-221 Rell, Magnetic: the printed energy cap has no ObjectFilter vocabulary and no raw-matcher semantics", () => {
  const filter = play.picks[0].filter;

  // The merged filter adapter fails closed on the printed cap...
  assert.throws(
    () => translateObjectFilter(filter),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Unsupported filter field energyLte/);
      return true;
    }
  );

  // ...and the underlying ObjectFilter matcher does not read the key at all.
  // Isolate the controller condition first (the raw matcher compares the
  // literal "controller" spelling against the object's controller, so the
  // printed pick's own controller key must be neutralized here) and then
  // bracket the printed Energy cap with equipment at 2 and 3.
  const handGear = (energy) => ({
    ref: { id: "gear", zoneEntryId: 1 },
    id: "gear",
    types: ["gear"],
    tags: ["Equipment"],
    zone: "hand",
    controller: filter.controller,
    owner: "A",
    energy
  });
  // Energy 2 satisfies the printed cap, energy 3 violates it — the raw matcher
  // returns true for both, proving energyLte is silently ignored (never
  // narrowed) rather than evaluated.
  assert.equal(matchesObjectFilter(filter, handGear(2)), true);
  assert.equal(matchesObjectFilter(filter, handGear(3)), true);
});

test.todo(
  "sfd-024-221 Rell, Magnetic: the printed Energy cap (energyLte) needs ObjectFilter vocabulary and a raw-matcher " +
    "predicate so an Equipment above the cap is excluded before the pick binds (CR 818.1.a; RIFT-221 cost-kind work)"
);
