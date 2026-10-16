import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/fiora-victorious.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { LayerEngine } from "../../../../engine-core/dist/layers/engine.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-184064ceedf3bc8c1c777c425d1bc971c0b7a878cde5573d58da57509cf5d08e";
const [ability] = program.abilities;

test("ogn-232-298 Fiora, Victorious: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-232-298 Fiora, Victorious: identity, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /target\.tax/);
  assert.match(program.judgeReason, /continuous\.movement/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.equal(
    program.sourceText,
    "While I'm [Mighty], I have [Deflect], [Ganking], and [Shield]. (I'm Mighty while I have 5+ :rb_might:.)"
  );
});

test("ogn-232-298 Fiora, Victorious: one static ability conditionally granting the three keywords", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.grant-keyword");
  assert.equal(ability.effect.appliesTo, "self");
  // CR 809.1.b.3 / 814.1.b.3: omitted values default to 1; CR 810: Ganking has no value.
  assert.deepEqual(ability.effect.keywords, [
    { id: "Deflect", value: 1 },
    { id: "Ganking" },
    { id: "Shield", value: 1 }
  ]);
});

test("ogn-232-298 Fiora, Victorious: the grant is gated on the Might >= 5 Mighty description", () => {
  // CR 708/710: a unit is Mighty while its current Might is 5 or greater.
  assert.deepEqual(ability.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "might" },
    operator: "gte",
    right: { kind: "constant", value: 5 }
  });
});

test("ogn-232-298 Fiora, Victorious: the declared condition evaluates on the reference kernel at the Mighty threshold", () => {
  for (const [might, expected] of [[4, false], [5, true]]) {
    const kernel = world().unit("fiora", { might }).build();
    const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("fiora") });
    assert.equal(scoped.test(ability.condition), expected, "Mighty at Might " + might);
  }
});

test("ogn-232-298 Fiora, Victorious: the layer engine's ability layer ignores the declared Might comparison (gap)", () => {
  // This documents the missing consumer: conditionMatches() does not evaluate
  // object-property comparisons, so the keyword grant is currently unconditional in the
  // layers path (keywords appear at Might 4 as well). Only the Might arithmetic layer
  // reacts to a numeric amount, which this card's conditional grant never provides.
  const engine = new LayerEngine([{
    ref: { id: "fiora", zoneEntryId: 1 },
    cardId: "card:ogn-232-298",
    name: "Fiora, Victorious",
    types: ["unit"],
    tags: ["Demacia"],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "battlefield-1" },
    might: 4,
    energy: 4,
    power: ["Order"],
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  }]);
  engine.addContinuous({
    id: "fiora:declared",
    layer: "ability",
    source: { id: "fiora", zoneEntryId: 1 },
    filter: { type: "unit" },
    effect: { ...ability.effect, condition: ability.condition }
  }, { type: "permanent" });

  const evaluated = engine.evaluate({ id: "fiora", zoneEntryId: 1 });
  assert.deepEqual(evaluated.keywords.map(keyword => keyword.id), ["Deflect", "Ganking", "Shield"]);
  assert.equal(evaluated.keywords.find(keyword => keyword.id === "Deflect").value, 1);
  // Ganking has no printed value, so the layer keeps value undefined (CR 810).
  assert.equal(evaluated.keywords.find(keyword => keyword.id === "Ganking").value, undefined);
  assert.equal(evaluated.might, 4);
});

test.todo(
  "ogn-232-298 Fiora, Victorious: applying the Might comparison in the layers ability layer " +
    "(CR 706-711) plus the Deflect target tax (CR 809.1.c, RIFT-90), the continuous.movement " +
    "consumer (CR 810.1.b/144.4.c.1), and the Shield continuous.might consumer (CR 814.1.c, RIFT-91)"
);
