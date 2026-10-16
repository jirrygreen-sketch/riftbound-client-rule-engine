import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "@riftbound/card-dsl";

import assault, { ASSAULT_DEFAULT_VALUE, SELF_OBJECT_REF } from "../../../dist/effects/keywords/Assault.js";
import { keywordDefinitionsById } from "../../../dist/effects/keywords/registry.generated.js";
import { instructionDefinitionsById } from "../../../dist/effects/instructions/registry.generated.js";
import { runInstruction, world } from "../../../dist/effects/testing/index.js";

const HOST = Object.freeze({ canonicalCardId: "ogn-232-298" });

/** Wrap expanded abilities in a minimal CardProgram shell for validation. */
const wrapProgram = (abilities) => ({
  canonicalCardId: HOST.canonicalCardId,
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities,
  sourceText: "[Assault]"
});

const amountOf = (ability) => ability.effect.amount.value;
const conditionOf = (ability) => ability.condition;

test("KeywordDef identity: keyword name, valued flag and v1.5 rule refs (807 family)", () => {
  assert.equal(assault.keyword, "Assault");
  assert.equal(assault.valued, true);
  for (const ref of ["807", "807.1.b.3", "807.1.c", "807.2"]) {
    assert.ok(assault.ruleRefs.includes(ref), "missing rule ref " + ref);
  }
});

test("expand with an explicit value emits one static continuous.might ability keyed to the Attacker designation", () => {
  const abilities = assault.expand({ value: 2, host: HOST });
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
  assert.equal(condition.right.value, "attacker");
});

test("expand without a value presumes Assault 1 (CR 807.1.b.3)", () => {
  const abilities = assault.expand({ host: HOST });
  assert.equal(abilities.length, 1);
  assert.equal(amountOf(abilities[0]), ASSAULT_DEFAULT_VALUE);
  assert.equal(ASSAULT_DEFAULT_VALUE, 1);
});

test("every expansion validates through validateCardProgram inside a minimal program", () => {
  for (const value of [undefined, 1, 2, 4, 12]) {
    const abilities = value === undefined
      ? assault.expand({ host: HOST })
      : assault.expand({ value, host: HOST });
    const result = validateCardProgram(wrapProgram(abilities));
    assert.deepEqual(result.issues, []);
    assert.equal(result.ok, true);
  }
});

test("stacking is sum: multiple granted Assaults are added and expanded once (CR 807.2)", () => {
  assert.equal(assault.stacking, "sum");
  // Official 807.2 example: printed Assault (default 1) + Cleave granting
  // Assault 3 sum into a single Assault 4 expansion.
  const summed = assault.expand({ value: 1 + 3, host: HOST });
  assert.equal(summed.length, 1);
  assert.equal(amountOf(summed[0]), 4);
});

test("grants with an omitted value sum with the default 1 (CR 807.1.b.3 + 807.2)", () => {
  const grantedDefault = assault.expand({ host: HOST });
  const printed = assault.expand({ value: 2, host: HOST });
  const merged = assault.expand({
    value: amountOf(grantedDefault[0]) + amountOf(printed[0]),
    host: HOST
  });
  assert.equal(amountOf(merged[0]), 3);
});

test("edge values 0 and large values expand verbatim without clamping", () => {
  assert.equal(amountOf(assault.expand({ value: 0, host: HOST })[0]), 0);
  assert.equal(amountOf(assault.expand({ value: 9, host: HOST })[0]), 9);
  assert.equal(amountOf(assault.expand({ value: 99, host: HOST })[0]), 99);
});

test("every expansion is gated on the Attacker designation, never Defender (CR 807.1.d)", () => {
  for (const value of [undefined, 1, 2, 4]) {
    const abilities = value === undefined
      ? assault.expand({ host: HOST })
      : assault.expand({ value, host: HOST });
    const condition = conditionOf(abilities[0]);
    assert.equal(condition.right.value, "attacker");
  }
});

test("the generated keyword registry exposes Assault under its keyword id (build-time codegen)", () => {
  assert.equal(keywordDefinitionsById.get("Assault"), assault);
});

test("reference-kernel execution: combat damage through the merged damage primitive uses the expanded Might (Rumble, sfd-003-221)", () => {
  // The expansion itself is a layer effect evaluated by RIFT-91 layers and is
  // intentionally not re-executed here. What runs on the merged interpreter is
  // the combat-damage instruction that consumes the resulting Might: an
  // Assault 2 attacker (2 printed + 2 Assault = 4 effective Might) deals 4
  // combat damage to its defender.
  const damage = instructionDefinitionsById.get("effect.damage");
  const kernel = world()
    .unit("attacker", { might: 2, keywords: [{ id: "assault", value: 2 }] })
    .unit("defender", { might: 3 })
    .build();
  const run = runInstruction(
    damage,
    {
      amount: { kind: "literal", value: 4 },
      target: "defender",
      combat: true
    },
    {
      world: kernel,
      targets: { defender: [kernel.ref("defender")] },
      linked: {}
    }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.events.every((event) => event.action === "damage"), true);
});
