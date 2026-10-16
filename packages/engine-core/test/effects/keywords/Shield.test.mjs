import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "@riftbound/card-dsl";

import shield, { SHIELD_DEFAULT_VALUE, SELF_OBJECT_REF } from "../../../dist/effects/keywords/Shield.js";
import { keywordDefinitionsById } from "../../../dist/effects/keywords/registry.generated.js";
import { instructionDefinitionsById } from "../../../dist/effects/instructions/registry.generated.js";
import { runInstruction, world } from "../../../dist/effects/testing/index.js";

const HOST = Object.freeze({ canonicalCardId: "ogn-241-298" });

/** Wrap expanded abilities in a minimal CardProgram shell for validation. */
const wrapProgram = (abilities) => ({
  canonicalCardId: HOST.canonicalCardId,
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities,
  sourceText: "[Shield]"
});

const amountOf = (ability) => ability.effect.amount.value;
const conditionOf = (ability) => ability.condition;

test("KeywordDef identity: keyword name, valued flag and v1.5 rule refs (814 family)", () => {
  assert.equal(shield.keyword, "Shield");
  assert.equal(shield.valued, true);
  for (const ref of ["814", "814.1.b.3", "814.1.c", "814.2"]) {
    assert.ok(shield.ruleRefs.includes(ref), "missing rule ref " + ref);
  }
});

test("expand with an explicit value emits one static continuous.might ability keyed to the Defender designation", () => {
  const abilities = shield.expand({ value: 2, host: HOST });
  assert.equal(abilities.length, 1);
  const [ability] = abilities;
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(amountOf(ability), 2);
  const condition = conditionOf(ability);
  assert.equal(condition.kind, "compare");
  assert.equal(condition.left.kind, "object-property");
  assert.equal(condition.left.object, SELF_OBJECT_REF);
  assert.equal(condition.left.object, "self");
  assert.equal(condition.left.property, "designation");
  assert.equal(condition.operator, "eq");
  assert.equal(condition.right.value, "defender");
});

test("expand without a value presumes Shield 1 (CR 814.1.b.3)", () => {
  const abilities = shield.expand({ host: HOST });
  assert.equal(abilities.length, 1);
  assert.equal(amountOf(abilities[0]), SHIELD_DEFAULT_VALUE);
  assert.equal(SHIELD_DEFAULT_VALUE, 1);
});

test("every expansion validates through validateCardProgram inside a minimal program", () => {
  for (const value of [undefined, 1, 2, 3, 10]) {
    const abilities = value === undefined
      ? shield.expand({ host: HOST })
      : shield.expand({ value, host: HOST });
    const result = validateCardProgram(wrapProgram(abilities));
    assert.deepEqual(result.issues, []);
    assert.equal(result.ok, true);
  }
});

test("stacking is sum: multiple granted Shields are added and expanded once (CR 814.2)", () => {
  assert.equal(shield.stacking, "sum");
  // Official 814.2 example: printed Shield (default 1) + Block granting
  // Shield 3 sum into a single Shield 4 expansion.
  const summed = shield.expand({ value: 1 + 3, host: HOST });
  assert.equal(summed.length, 1);
  assert.equal(amountOf(summed[0]), 4);
});

test("grants with an omitted value sum with the default 1 (CR 814.1.b.3 + 814.2)", () => {
  const grantedDefault = shield.expand({ host: HOST });
  const printed = shield.expand({ value: 2, host: HOST });
  const merged = shield.expand({
    value: amountOf(grantedDefault[0]) + amountOf(printed[0]),
    host: HOST
  });
  assert.equal(amountOf(merged[0]), 3);
});

test("edge values 0 and large values expand verbatim without clamping", () => {
  assert.equal(amountOf(shield.expand({ value: 0, host: HOST })[0]), 0);
  assert.equal(amountOf(shield.expand({ value: 7, host: HOST })[0]), 7);
  assert.equal(amountOf(shield.expand({ value: 99, host: HOST })[0]), 99);
});

test("every expansion is gated on the Defender designation, never Attacker (CR 814.1.d)", () => {
  for (const value of [undefined, 1, 2, 3]) {
    const abilities = value === undefined
      ? shield.expand({ host: HOST })
      : shield.expand({ value, host: HOST });
    const condition = conditionOf(abilities[0]);
    assert.equal(condition.right.value, "defender");
  }
});

test("the generated keyword registry exposes Shield under its keyword id (build-time codegen)", () => {
  assert.equal(keywordDefinitionsById.get("Shield"), shield);
});

test("reference-kernel execution: combat damage through the merged damage primitive uses the expanded Might (Fiora, ogn-241-298)", () => {
  // The expansion itself is a layer effect evaluated by RIFT-91 layers and is
  // intentionally not re-executed here. What runs on the merged interpreter is
  // the combat-damage instruction that consumes the resulting Might: a
  // Shield 2 defender (2 printed + 2 Shield = 4 effective Might) deals 4
  // combat damage back to its attacker.
  const damage = instructionDefinitionsById.get("effect.damage");
  const kernel = world()
    .unit("defender", { might: 2, keywords: [{ id: "shield", value: 2 }] })
    .unit("attacker", { might: 3 })
    .build();
  const run = runInstruction(
    damage,
    {
      amount: { kind: "literal", value: 4 },
      target: "attacker",
      combat: true
    },
    {
      world: kernel,
      targets: { attacker: [kernel.ref("attacker")] }
    }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.events.every((event) => event.action === "damage"), true);
});
