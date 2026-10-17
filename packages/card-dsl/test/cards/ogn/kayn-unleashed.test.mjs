import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/kayn-unleashed.js";

import { createProgramBinding, createEngineStaticBinder } from "../../../../engine-core/dist/programs/index.js";
import { LayerEngine } from "../../../../engine-core/dist/layers/engine.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-1958207f0c4a0be000a8fb2e9fefe3b7deac31092670ca1484b69d633b7df9b7";
const [ganking, replacement] = program.abilities;

test("program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("identity: canonicalCardId, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Ganking/);
  assert.match(program.judgeReason, /continuous\.movement/);
  assert.match(program.judgeReason, /moved twice/);
  assert.match(program.judgeReason, /permission\.routes/);
  assert.equal(
    program.sourceText,
    "[Ganking] (I can move from battlefield to battlefield.)\n" +
      "If I have moved twice this turn, I don't take damage."
  );
});

test("[Ganking] is declared as a keyword ability only (810; expansion belongs to the keyword registry)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(ganking, { kind: "keyword", keyword: "ganking" });
  assert.equal(ganking.value, undefined);
});

test("damage immunity records the intended twice-moved condition and a prevention replacement", () => {
  assert.equal(replacement.kind, "replacement");
  assert.deepEqual(replacement.replaces, { event: "damage", filter: { target: "self" } });
  assert.deepEqual(replacement.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "moves-this-turn",
      filter: { object: "self" }
    },
    operator: "gte",
    right: { kind: "constant", value: 2 }
  });
  // "I don't take damage" prevents the damage event (438.1/438.7); an empty
  // replacement body is the prevention shape consumed by the merged RIFT-260
  // pipeline; the card stays judge-required because the "moved twice"
  // condition cannot be evaluated from event history (see judgeReason).
  assert.deepEqual(replacement.with, []);
});

test("Kayn supported Ganking expansion registers the original static rule on its host", () => {
  const f = fixture({ cards: [{ id: "kayn", cardId: CANONICAL, types: ["unit"] }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("kayn"), to: "battlefield", location: { type: "battlefield", id: "battlefield-1" } });
  f.engine.advance();
  const source = f.kernel.getObject("kayn");
  const binding = createProgramBinding({ cardPrograms: [program] });
  const ability = binding.inspect(source).abilities.find(item => item.kind === "static");
  const handle = createEngineStaticBinder(f.engine).bindStatic(ability, source);
  const [entry] = f.engine.layers.registry.list();
  assert.equal(entry.effect.layer, "ability");
  assert.equal(entry.effect.effect.kind, "continuous.movement");
  assert.equal(entry.effect.effect.permission, "battlefield-to-battlefield");
  assert.equal(entry.effect.filter.objectId, "kayn");
  assert.equal(entry.effect.filter.zoneEntryId, source.ref.zoneEntryId);
  handle.unbind();
  assert.equal(f.engine.layers.registry.list().length, 0);
});

test.todo(
  "Kayn Ganking: adapt Ganking's string permission to the movement rule-query permission.routes array, then execute a battlefield-to-battlefield Standard Move (810.1.b, 144.4.c)"
);
test.todo(
  "Kayn: replacement matching counts this incarnation's Move events in the current turn before preventing damage (375, 438.7; RIFT-359)"
);

test("Kayn: the card's Ganking static ability really registers through the merged binding", () => {
  // RIFT-257's binder consumes the card's Ganking expansion and RIFT-258's ability layer records it;
  // this half of the card is real, and only the permission shape keeps the rule query blind.
  const kernel = world().unit("kayn", { cardId: CANONICAL, types: ["unit"], might: 5 }).build();
  const source = kernel.getObject("kayn");
  const layers = new LayerEngine(kernel.objects);
  layers.setObjects(kernel.objects);
  const binder = createEngineStaticBinder({
    layers,
    pipeline: {
      host: { objects: () => kernel.objects, context: () => kernel.clone({ sourceSnapshot: source }) },
      registerReplacement: () => {}
    }
  });
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const [gankingStatic] = binding.inspect(source).abilities.filter((ability) => ability.kind === "static");
  assert.equal(gankingStatic.effect.kind, "continuous.movement");
  assert.equal(gankingStatic.effect.permission, "battlefield-to-battlefield");
  binder.bindStatic(gankingStatic, source);
  assert.deepEqual(layers.registry.list().map((entry) => entry.effect.effect.kind), ["continuous.movement"]);
  assert.deepEqual(layers.registry.list().map((entry) => entry.effect.filter.objectId), ["kayn"]);
});

test("Kayn TODO: Ganking must open a battlefield-to-battlefield Standard Move (810.1.b, 144.4.c)", {
  todo: "810.1.b: normalize Ganking's string permission to the movement rule query's permission.routes array"
}, () => {
  // The correct rule result: the movement rule query reports the Ganking permission for this unit.
  // Today the keyword expansion records a STRING while layers/rules/query.ts reads
  // effect.permission.routes, so the query reports no permission at all; that absence is not
  // written as the expected behaviour.
  const kernel = world().unit("kayn", { cardId: CANONICAL, types: ["unit"], might: 5 }).build();
  const source = kernel.getObject("kayn");
  const layers = new LayerEngine(kernel.objects);
  layers.setObjects(kernel.objects);
  layers.addContinuous({
    id: "kayn-ganking",
    layer: "ability",
    source: source.ref,
    filter: { objectId: "kayn", zone: "board", zoneEntryId: source.ref.zoneEntryId },
    effect: {
      kind: "continuous.movement",
      permission: "battlefield-to-battlefield",
      source: "battlefield",
      destination: "battlefield",
      move: "standard",
      addsPermission: true
    }
  }, { type: "permanent" });
  const view = movement(layers.registry, source.ref, source, "A");
  assert.equal(view.canGank, true);
  assert.equal(view.battlefieldToBattlefield, true);
});

test("Kayn TODO: the declared move-count condition counts objects instead of this incarnation's moves", {
  todo: "375 / 438.7: count this incarnation's Move actions in the current turn when matching the replacement (RIFT-359)"
}, () => {
  // Two board objects and zero moves must satisfy "moved twice" = false. The merged
  // replacement-condition path evaluates the count as a live object-set query, so the
  // authored condition is true here; the correct expectation stays TODO rather than being
  // written as the expected behaviour.
  const kernel = world()
    .unit("kayn", { cardId: CANONICAL, types: ["unit"], might: 5 })
    .unit("other", { owner: "B", types: ["unit"], might: 3 })
    .build();
  assert.equal(kernel.history({ scope: "turn", action: "move-location" }), 0);
  assert.equal(kernel.test(replacement.condition), false);
});
