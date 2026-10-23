// Binding-gap scenarios: ../../templates/static-642.test.mjs.
// Local damage tests cover supported subeffects with an explicit bonus; they
// do not prove Annie's continuous grant and do not change her published status.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
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
  assert.match(program.judgeReason, /layerFor/);
  assert.match(program.judgeReason, /args\.bonus/);
  assert.match(program.judgeReason, /715\.3/);
  assert.match(program.judgeReason, /715\.4/);
  assert.doesNotMatch(program.judgeReason, /RIFT-257/);
});

test("ogs-001-024 Annie, Fiery: one static +1 Bonus Damage grant for the controller's spells and abilities", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);
  assert.equal(ability.effect.kind, "continuous.bonus-damage");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 1 });
  assert.deepEqual(ability.effect.appliesTo, {
    kind: "constant", value: "controller-spells-and-abilities"
  });
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

test("ogs-001-024 Annie, Fiery supported subeffect: an explicit +1 bonus increases the split total once (CR 715.3)", () => {
  const kernel = world().unit("u1").unit("u2").build();
  const targets = [kernel.ref("u1"), kernel.ref("u2")];
  const args = {
    amount: { kind: "constant", value: 5 },
    bonus: program.abilities[0].effect.amount,
    divide: true,
    target: "targets"
  };
  const waiting = runInstruction(damage, args, { world: kernel, targets: { targets } });
  assert.equal(waiting.result, null);
  assert.equal(waiting.asked.request.type, "number");
  assert.equal(waiting.asked.request.max, 5, "six total damage leaves at least one for the second target");
  assert.equal(kernel.getObject("u1").damage, 0);
  assert.equal(kernel.getObject("u2").damage, 0);

  const run = runInstruction(damage, args, {
    world: kernel,
    targets: { targets },
    answers: { "effect.damage:divide:0": 2, "effect.damage:divide:1": 4 }
  });
  assert.equal(run.asked, null);
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("u1").damage, 2);
  assert.equal(kernel.getObject("u2").damage, 4);
  assert.equal(run.linked.dealt, 6);
  assert.equal(run.linked.dealtCount, 2);
  assert.deepEqual(run.linked.dealtTo, [
    { target: targets[0], amount: 2 },
    { target: targets[1], amount: 4 }
  ]);
  assert.deepEqual(run.events.map(event => event.action), ["damage", "damage"]);
});

test("ogs-001-024 Annie, Fiery supported subeffect: an explicit bonus creates no Deal without targets", () => {
  const kernel = world().unit("bystander").build();
  const run = runInstruction(damage, {
    amount: { kind: "constant", value: 3 },
    bonus: program.abilities[0].effect.amount,
    target: "targets"
  }, { world: kernel, targets: { targets: [] } });
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(kernel.getObject("bystander").damage, 0);
  assert.deepEqual(run.events, []);
  assert.equal(run.linked.dealt, undefined);
});

test("ogs-001-024 Annie, Fiery golden: the production static binder registers the action-scoped grant", () => {
  // The binder now maps continuous.bonus-damage and preserves the controller's
  // spell/ability scope. The Damage action still needs a consumer that reads
  // this registration; the two TODO assertions below define that remaining
  // whole-card behavior without substituting a manual Bonus Damage value.
  const { engine, kernel } = fixture({ cards: [{ id: "annie", cardId: program.canonicalCardId, might: 4 }] });
  engine.commit({ type: "move-zone", object: kernel.ref("annie"), to: "base", location: { type: "base", player: "A" } });
  const source = kernel.getObject("annie");
  const handle = createEngineStaticBinder(engine).bindStatic(program.abilities[0], source);
  const registration = engine.layers.registry.list().find(entry =>
    entry.effect.effect.kind === "continuous.bonus-damage");
  assert.ok(registration);
  assert.equal(registration.effect.sequence, undefined);
  assert.equal(registration.effect.source.id, "annie");
  assert.deepEqual(registration.effect.effect.amount, { kind: "constant", value: 1 });
  assert.equal(registration.effect.effect.appliesTo, "controller-spells-and-abilities");
  assert.equal(registration.effect.effect.sourcePlayer, "A");
  assert.deepEqual(registration.effect.filter, {
    type: ["spell", "ability"],
    controller: "controller"
  });
  handle.unbind();
  assert.equal(engine.layers.registry.list().length, 0);
});

test("ogs-001-024 Annie, Fiery golden: the production lifecycle installs the grant without reporting an error", () => {
  // The lifecycle binds static abilities when a permanent enters the Board.
  // Binding succeeds now; DMG-02 remains the missing whole-card consumer.
  const { engine, kernel } = fixture({ cards: [{ id: "annie", cardId: program.canonicalCardId, might: 4 }] });
  const errors = [];
  const registry = new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]);
  attachProgramLifecycle(engine, registry, undefined, (error) => errors.push(error));
  engine.commit({ type: "move-zone", object: kernel.ref("annie"), to: "base", location: { type: "base", player: "A" } });
  assert.deepEqual(errors, []);
  assert.ok(engine.layers.registry.list().some(entry =>
    entry.effect.effect.kind === "continuous.bonus-damage"));
});

test.todo(
  "ogs-001-024 Annie, Fiery: the continuous +1 Bonus Damage grant reaches Deal actions " +
    "created by this controller's spells and abilities (CR 712-715, 418.4/418.5) — " +
    "needs a continuous.bonus-damage grant and a layers/statics action-scope mapping; " +
    "today staticTarget rejects appliesTo before layerFor can run"
);

test.todo(
  "ogs-001-024 Annie, Fiery: the continuous +1 Bonus Damage grant reaches Deal actions " +
    "created by this controller's spells and abilities (CR 712-715, 418.4/418.5) — " +
    "needs a damage-pipeline consumer that collects and sums controller-scoped static grants, " +
    "including split totals (715.3) and no-Deal handling (715.4)"
);
