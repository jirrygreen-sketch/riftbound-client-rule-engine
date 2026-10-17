import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/party-crasher.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import tank from "../../../../engine-core/dist/effects/keywords/Tank.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { evaluateExpression } from "../../../../engine-core/dist/effects/interpreter/expr.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-51a7a5074ce15f7be681afd13ce27fd042c4566c3987a18a4e7dafdf0faadc53";

test("rad-122-167 Party Crasher: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.judgeReason.includes("Tank"), true);
  assert.equal(program.judgeReason.includes("continuous.cost-modification"), true);
  // 2026-10-17: the reason must record the observed binder rejection and the
  // un-evaluable relative-player per count instead of the merged-task numbers.
  assert.match(program.judgeReason, /Static ability kind continuous\.cost-modification has no layer mapping/);
  assert.match(program.judgeReason, /相对玩家/);
  assert.equal(program.sourceText, "I cost :rb_energy_1: less for each exhausted unit you control.\n[Tank] (I must be assigned combat damage first.)");
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-122-167 Party Crasher: [Tank] keyword plus the per-exhausted-unit energy discount", () => {
  assert.equal(program.abilities.length, 2);
  const [tankAbility, discount] = program.abilities;
  assert.deepEqual(tankAbility, { kind: "keyword", keyword: "tank" });
  assert.equal(discount.kind, "static");
  assert.equal(discount.effect.kind, "continuous.cost-modification");
  assert.equal(discount.effect.resource, "energy");
  assert.equal(discount.effect.appliesTo, "self");
  assert.deepEqual(discount.effect.amount, { kind: "constant", value: -1 });
  assert.deepEqual(discount.effect.per.filter, {
    type: "unit", controller: "controller", states: "exhausted"
  });
  assert.equal(discount.condition.operator, "gte");
  assert.deepEqual(discount.condition.right, { kind: "constant", value: 1 });
});

test("rad-122-167 Party Crasher: merged Tank KeywordDef expands to a combat ability", () => {
  const registered = keywordDefinitionsById.get("Tank");
  assert.equal(registered, tank);
  const [expanded] = tank.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expanded.kind, "static");
  assert.deepEqual(expanded.effect, {
    kind: "continuous.combat",
    appliesTo: "self",
    mode: "damage-assignment",
    priority: "first",
    damage: "lethal",
    controllerScope: "same-controller",
    excludesKeyword: "Tank"
  });
});

test("rad-122-167 Party Crasher: program binding registers Tank in the ability layer", () => {
  const executableProgram = { ...program, status: "executable", judgeReason: undefined };
  const binding = createProgramBinding({ cardPrograms: [executableProgram] });
  const inspected = binding.inspect({
    ref: { id: "party", zoneEntryId: 1 },
    cardId: CANONICAL,
    name: "Party Crasher",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "hand",
    location: null,
    might: 6,
    energy: 9,
    power: ["Order"],
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  });
  assert.ok(inspected.abilities.some(ability =>
    ability.kind === "static" && ability.effect.kind === "continuous.combat"
  ));

  const f = fixture({
    cards: [{ id: "party", cardId: CANONICAL, types: ["unit"], might: 6 }],
    describePlay: binding.describePlay
  });
  binding.attachLifecycle(f.engine);
  f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref("party"),
    to: "battlefield",
    location: { type: "battlefield", id: "battlefield-1" }
  });
  const entries = f.engine.layers.registry.list();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].effect.layer, "ability");
  assert.equal(entries[0].effect.effect.kind, "continuous.combat");

  f.engine.commit({ type: "kill", object: f.kernel.ref("party") });
  assert.equal(f.engine.layers.registry.list().length, 0);
});

test("rad-122-167 Party Crasher: the production static binder refuses the printed cost reduction (356.4)", () => {
  // programs/statics.ts layerFor has no continuous.cost-modification branch, so
  // the discount never reaches the layers registry or a Finalize cost plan.
  const engine = {
    layers: { registry: { list: () => [] }, addContinuous: () => {}, removeContinuous: () => {}, currentTimingPoint: "main-start" },
    pipeline: { host: {} }
  };
  const source = {
    ref: { id: "party", zoneEntryId: 1 },
    cardId: CANONICAL,
    name: "Party Crasher",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "base", player: "A" },
    might: 6,
    energy: 9,
    power: ["Order"],
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const discount = program.abilities[1];
  assert.equal(discount.kind, "static");
  assert.throws(
    () => createEngineStaticBinder(engine).bindStatic(discount, source),
    error => error.code === "judge-required" &&
      /Static ability kind continuous\.cost-modification has no layer mapping/.test(error.message)
  );
  assert.equal(engine.layers.registry.list().length, 0);
});

test("rad-122-167 Party Crasher: the per-count's relative player anchor does not resolve (356.4.g)", () => {
  // "for each exhausted unit you control": the query needs the ability
  // controller. As authored, neither merged comparison resolves it: the layer
  // filter's "self" spelling degenerates to an object-vs-itself test (counting
  // opponents too), and the interpreter's literal comparison finds nothing, so
  // the guard condition is false even with two exhausted friendly units.
  const kernel = world()
    .unit("friendly-1", { controller: "A", owner: "A", exhausted: true })
    .unit("friendly-2", { controller: "A", owner: "A", exhausted: true })
    .unit("enemy-1", { controller: "B", owner: "B", exhausted: true })
    .build();
  const environment = {
    context: bindResolveContext(kernel, { source: kernel.getObject("friendly-1"), controller: "A" }),
    host: kernel.ref("friendly-1"),
    isIgnored: () => false,
    canLookBack: () => false
  };
  const discount = program.abilities[1];
  // As authored (controller: "controller"): no units found -> the condition is
  // false, so the reduction never applies at all.
  assert.equal(evaluateExpression(discount.effect.per, environment), 0);
  assert.equal(evaluateCondition(discount.condition, environment), false);
  // The "self" spelling is the layer engine's relative-player form, but it
  // matches every unit in the object-vs-itself comparison, including the
  // opponent's — so it cannot stand in for "you control" either.
  assert.equal(
    evaluateExpression({ ...discount.effect.per, filter: { ...discount.effect.per.filter, controller: "self" } }, environment),
    0,
    "the interpreter path does not resolve controller: self either"
  );
  // Only an explicit player id resolves the controller, and even then the
  // interpreter set query ignores the `states` qualifier, so a ready friendly
  // unit is counted as exhausted. A card program must not hardcode a player id,
  // so the per-count cannot be authored soundly today (356.4.g).
  const withExplicitController = { ...discount.effect.per, filter: { ...discount.effect.per.filter, controller: "A" } };
  assert.equal(evaluateExpression(withExplicitController, environment), 2);
  assert.equal(
    environment.context.query({ type: "unit", controller: "A", states: "exhausted" }).length,
    environment.context.query({ type: "unit", controller: "A" }).length,
    "the interpreter query ignores states, so exhausted units cannot be isolated"
  );
  // layers/filter.ts does honour states, but only an explicit player id excludes
  // the opponent there — the same missing relative-player anchor.
  assert.equal(matchesObjectFilter({ type: "unit", controller: "A", states: "exhausted" }, environment.context.query({ type: "unit" })[0]), true);
  assert.equal(matchesObjectFilter({ type: "unit", controller: "self", states: "exhausted" }, environment.context.query({ type: "unit" })[0]), true);
});

test("rad-122-167 Party Crasher: the merged layer filter's controller: self counts the opponent too", () => {
  // Concrete evidence for the over-count: through layers/filter.ts, which is
  // the path a bound layer effect would use.
  const kernel = world()
    .unit("friendly-1", { controller: "A", owner: "A", exhausted: true })
    .unit("enemy-1", { controller: "B", owner: "B", exhausted: true })
    .build();
  const matches = matchesObjectFilter({ type: "unit", controller: "self", states: "exhausted" }, kernel.getObject("enemy-1"));
  assert.equal(matches, true, "an opposed exhausted unit satisfies controller: self");
  assert.equal(
    matchesObjectFilter({ type: "unit", controller: "A", states: "exhausted" }, kernel.getObject("enemy-1")),
    false,
    "an explicit player id is required to exclude the opponent"
  );
});

test.todo(
  "rad-122-167 Party Crasher: Tank's continuous.combat effect still needs the combat damage " +
    "assignment consumer so lethal damage is assigned to Tank units first (815.1.b/c); " +
    "base-combat-allocation.ts currently proves keywordPriority=proven-none"
);

test.todo(
  "rad-122-167 Party Crasher: the Finalize cost pipeline must consume continuous.cost-modification " +
    "and count each exhausted friendly unit as a -1 Energy reduction (356.4/356.4.g) — the static " +
    "binder rejects the kind (no layerFor mapping), the interpreter set query ignores the states " +
    "qualifier, and neither merged query path resolves the controller-relative per filter"
);
