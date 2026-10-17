import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { ProgramBindingError } from "../../../../engine-core/dist/programs/errors.js";
import { attachProgramLifecycle } from "../../../../engine-core/dist/programs/lifecycle.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
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
  assert.match(program.judgeReason, /continuous\.bonus-damage/);
  assert.match(program.judgeReason, /staticTarget/);
  assert.doesNotMatch(program.judgeReason, /RIFT-257/);
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

test("ogs-001-024 Annie, Fiery golden: the production static binder rejects this grant at bind time", () => {
  // 复核 2026-10-17: the production static binding path (createEngineStaticBinder,
  // wired into the chain lifecycle) is merged, so the stale RIFT-257 half is gone.
  // What blocks this card today is the binder itself: layerFor has no
  // continuous.bonus-damage layer mapping and staticTarget cannot express an
  // action-scoped grant, so the ability never reaches a layer.
  const { engine, kernel } = fixture({ cards: [{ id: "annie", cardId: program.canonicalCardId, might: 4 }] });
  engine.commit({ type: "move-zone", object: kernel.ref("annie"), to: "base", location: { type: "base", player: "A" } });
  const source = kernel.getObject("annie");
  assert.throws(
    () => createEngineStaticBinder(engine).bindStatic(program.abilities[0], source),
    (error) => error instanceof ProgramBindingError &&
      error.code === "judge-required" &&
      /Unsupported static appliesTo/.test(error.message)
  );
  // Dropping appliesTo only moves the failure to the missing layer mapping; the
  // effect kind still has no consumer anywhere in layers/ or the damage pipeline.
  assert.throws(
    () => createEngineStaticBinder(engine).bindStatic(
      { kind: "static", effect: { ...program.abilities[0].effect, appliesTo: undefined } },
      source
    ),
    (error) => error instanceof ProgramBindingError &&
      error.code === "judge-required" &&
      /has no layer mapping/.test(error.message)
  );
  assert.equal(engine.layers.registry.list().length, 0);
});

test("ogs-001-024 Annie, Fiery golden: the production trigger/static lifecycle surfaces the binder failure", () => {
  // The lifecycle attaches static abilities automatically when a permanent
  // enters the Board; onError receives the same ProgramBindingError, which is
  // the current, merged evidence for this card's judge-required status.
  const { engine, kernel } = fixture({ cards: [{ id: "annie", cardId: program.canonicalCardId, might: 4 }] });
  const errors = [];
  const registry = new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]);
  attachProgramLifecycle(engine, registry, undefined, (error) => errors.push(error));
  engine.commit({ type: "move-zone", object: kernel.ref("annie"), to: "base", location: { type: "base", player: "A" } });
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof ProgramBindingError);
  assert.match(errors[0].message, /Unsupported static appliesTo/);
});

test.todo(
  "ogs-001-024 Annie, Fiery: the continuous +1 Bonus Damage grant reaches Deal actions " +
    "created by this controller's spells and abilities (CR 712-715, 418.4/418.5) — " +
    "needs a continuous.bonus-damage opcode plus a layers/statics action-scope mapping and a " +
    "damage-pipeline consumer; today bindStatic fails on the missing layer mapping"
);

test.todo(
  "ogs-001-024 Annie, Fiery: the continuous +1 Bonus Damage grant reaches Deal actions " +
    "created by this controller's spells and abilities (CR 712-715, 418.4/418.5) — " +
    "the static layer has no continuous.bonus-damage mapping and the damage pipeline has no " +
    "consumer that derives a Bonus Damage grant from this static ability"
);
