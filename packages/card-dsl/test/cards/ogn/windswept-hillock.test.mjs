import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/windswept-hillock.js";
import ganking from "../../../../engine-core/dist/effects/keywords/Ganking.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";
import movementInstruction from "../../../../engine-core/dist/effects/instructions/continuous.movement.js";
import { runInstruction } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-ce3c166d72907a0d5807cb816eb9409a1ebc640347881bf29b083c9f4789e4de";
const SOURCE_TEXT = "Units here have [Ganking]. (They can move from battlefield to battlefield.)";
const BATTLEFIELD = id => ({ type: "battlefield", id });

const [ability] = program.abilities;

/** The hillock, one unit at its battlefield and one at another battlefield. */
function hillockWorld() {
  const kernel = world()
    .battlefield("windswept-hillock", { types: ["battlefield"], location: BATTLEFIELD("bf-1") })
    .unit("unit-here", { location: BATTLEFIELD("bf-1") })
    .unit("unit-elsewhere", { location: BATTLEFIELD("bf-9") })
    .build();
  return kernel.clone({
    source: kernel.ref("windswept-hillock"),
    sourceSnapshot: kernel.getObject("windswept-hillock")
  });
}

test("Windswept Hillock program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Ganking/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /static binder/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /hasGanking:false/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("Windswept Hillock structure: one static Ganking grant scoped to units here", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);

  // 479.3.b: "have [Ganking]" is an ability-altering static effect; the keyword
  // id must match the registered KeywordDef exactly.
  assert.equal(ability.effect.kind, "continuous.grant-keyword");
  assert.equal(ability.effect.keyword, "Ganking");
  assert.equal(ability.effect.value, undefined);
  // 053.3: "here" is this Battlefield; the grant is not restricted to the
  // controller's units (the card says "Units here").
  assert.deepEqual(ability.effect.filter, {
    type: "unit",
    zone: "board",
    sameLocationAs: "self"
  });
  assert.equal(ability.effect.filter.controller, undefined);
});

test("Windswept Hillock: the granted keyword id resolves to the merged Ganking definition", () => {
  const definition = keywordDefinitionsById.get(ability.effect.keyword);
  assert.ok(definition, "the granted KeywordId must be registered");
  assert.equal(definition, ganking);
  assert.equal(definition.valued, false);
  // 810.2: multiple Ganking instances are redundant.
  assert.equal(definition.stacking, "single");

  // 810.1.c: the expansion adds the Battlefield→Battlefield option to the
  // Standard Move without touching the unit's other options.
  const [staticAbility] = definition.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(staticAbility.kind, "static");
  assert.deepEqual(staticAbility.effect, {
    kind: "continuous.movement",
    permission: "battlefield-to-battlefield",
    source: "battlefield",
    destination: "battlefield",
    move: "standard",
    addsPermission: true
  });
});

test("Windswept Hillock golden: the merged grant instruction grants only the unit here", () => {
  const kernel = hillockWorld();
  // The equivalent instruction path for the static grant uses the merged
  // continuous.grant-keyword op with the card's own keyword and filter. The
  // interpreter query implements the 053.3 sameLocationAs anchor.
  const grant = {
    id: "windswept-hillock.grant-here",
    op: "continuous.grant-keyword",
    args: {
      keyword: { kind: "constant", value: ability.effect.keyword },
      filter: { kind: "constant", value: ability.effect.filter }
    }
  };
  const outcome = runAbilityBody([grant], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.granted.count, 1);
  assert.deepEqual(outcome.results[0].result.linkedValues.granted.objects, [
    { id: "unit-here", zoneEntryId: 1 }
  ]);
  // One ability-layer registration, addressed to the unit here only.
  assert.equal(kernel.continuousEffects.length, 1);
  assert.equal(kernel.continuousEffects[0].effect.filter.objectId, "unit-here");

  // The merged layer engine consumes the registration: the unit here has
  // Ganking; the unit at the other battlefield does not.
  const engine = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.deepEqual(
    engine.evaluate(kernel.ref("unit-here")).keywords.map(keyword => keyword.id),
    ["Ganking"]
  );
  assert.deepEqual(engine.evaluate(kernel.ref("unit-elsewhere")).keywords, []);
});

test("Windswept Hillock: the merged movement query consumes the expansion's permission", () => {
  const kernel = hillockWorld();
  const [staticAbility] = ganking.expand({ host: { canonicalCardId: CANONICAL } });
  const literal = value => ({ kind: "constant", value });
  // The granted Ganking expansion, per unit, runs through the merged
  // continuous.movement instruction.
  const run = runInstruction(
    movementInstruction,
    {
      permission: literal(staticAbility.effect.permission),
      source: literal(staticAbility.effect.source),
      destination: literal(staticAbility.effect.destination),
      move: literal(staticAbility.effect.move),
      addsPermission: literal(staticAbility.effect.addsPermission),
      target: literal("granted-unit")
    },
    { world: kernel, targets: { "granted-unit": [kernel.ref("unit-here")] } }
  );
  assert.equal(run.result.status, "executed");

  const registry = new ContinuousEffectRegistry();
  for (const entry of kernel.continuousEffects) registry.register(entry.effect, entry.duration);
  // The merged layers rule query reads the permission for the granted unit
  // only; the other unit keeps its plain Battlefield→Battlefield prohibition.
  assert.equal(movement(registry, kernel.ref("unit-here"), kernel.getObject("unit-here")).canGank, true);
  assert.equal(movement(registry, kernel.ref("unit-elsewhere"), kernel.getObject("unit-elsewhere")).canGank, false);
});

test.todo(
  "Windswept Hillock production static binder must grant Ganking to unit-here " +
    "by resolving the source-relative sameLocationAs filter; current binder yields no keyword."
);
