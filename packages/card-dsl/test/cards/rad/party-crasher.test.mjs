import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/party-crasher.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import tank from "../../../../engine-core/dist/effects/keywords/Tank.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";

const CANONICAL = "card.hash-51a7a5074ce15f7be681afd13ce27fd042c4566c3987a18a4e7dafdf0faadc53";

test("rad-122-167 Party Crasher: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.judgeReason.includes("Tank"), true);
  assert.equal(program.judgeReason.includes("continuous.cost-modification"), true);
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

test.todo(
  "rad-122-167 Party Crasher: Tank's continuous.combat effect still needs the combat damage " +
    "assignment consumer so lethal damage is assigned to Tank units first (815.1.b/c); " +
    "base-combat-allocation.ts currently proves keywordPriority=proven-none"
);

test.todo(
  "rad-122-167 Party Crasher: the Finalize cost pipeline must consume continuous.cost-modification " +
    "and count each exhausted friendly unit as a -1 Energy reduction (356.4/356.4.g)"
);
