import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import program from "../../../dist/cards/ogs/annie-fiery.js";

const CANONICAL =
  "card.hash-cb7e947fa0684712ff2e8dbc8148eaa39687afa9028c093d407a3dc1f84712a5";
const SOURCE_TEXT =
  "Your spells and abilities deal 1 Bonus Damage. (Each instance of damage the spell deals is increased by 1.)";

test("ogs-001-024 Annie, Fiery: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogs-001-024 Annie, Fiery: judgeReason names the missing Bonus Damage grant primitive", () => {
  assert.match(program.judgeReason, /continuous\.bonus-damage|Bonus Damage/);
  assert.match(program.judgeReason, /RIFT-258/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /Bonus Damage/);
});

test("ogs-001-024 Annie, Fiery: one static +1 Bonus Damage grant for the controller's spells and abilities", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);
  assert.equal(ability.effect.kind, "continuous.bonus-damage");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 1 });
  assert.deepEqual(ability.effect.filter, {
    type: ["spell", "ability"],
    controller: "controller"
  });
});

test("ogs-001-024 Annie, Fiery: effect.damage applies a +1 Bonus Damage to every target (CR 715.2)", () => {
  // The layer grant has no consumer yet (judgeReason). The damage half of the
  // rule chain is merged: a +1 Bonus Damage is summed (714) and applied to
  // each target separately (715.2).
  const kernel = world().unit("u1").unit("u2").build();
  const run = runInstruction(
    damage,
    {
      amount: { kind: "constant", value: 3 },
      bonus: { kind: "constant", value: 1 },
      target: "targets"
    },
    { world: kernel, targets: { targets: [kernel.ref("u1"), kernel.ref("u2")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("u1").damage, 4);
  assert.equal(kernel.getObject("u2").damage, 4);
  assert.deepEqual(run.events.map(event => event.action), ["damage", "damage"]);
});

test("ogs-001-024 Annie, Fiery: a negative Bonus Damage is not applied (CR 714.2)", () => {
  const kernel = world().unit("u1").build();
  const run = runInstruction(
    damage,
    {
      amount: { kind: "constant", value: 3 },
      bonus: { kind: "constant", value: -5 },
      target: "targets"
    },
    { world: kernel, targets: { targets: [kernel.ref("u1")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("u1").damage, 3);
});

test.todo(
  "ogs-001-024 Annie, Fiery: the continuous +1 Bonus Damage grant reaches Deal actions " +
    "created by this controller's spells and abilities (CR 712-715, 418.4/418.5) — " +
    "no continuous.bonus-damage instruction primitive or damage-pipeline consumer is merged " +
    "(RIFT-258 covers might/keyword/combat grants only), and the static-ability registration path " +
    "itself still awaits RIFT-257"
);
