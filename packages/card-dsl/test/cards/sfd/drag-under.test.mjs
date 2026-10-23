import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/drag-under.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import { createEngineStaticBinder, staticCostSources } from "../../../../engine-core/dist/programs/statics.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { translateInstructionTargets } from "../../../../engine-core/dist/programs/filters.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [keyword, costModification, play] = program.abilities;
const killInstruction = play.body[0];

test("Drag Under program is valid EffectIR v2 data and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(
    program.canonicalCardId,
    "card.hash-aaa1325feb0034c6e6408ff32eff79926e80a52b19fc29dfeffe6718b4ed6afe"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /366\.2/);
  assert.match(program.judgeReason, /layerFor/);
  assert.match(program.judgeReason, /not-hand/);
  // RIFT-357 landed: the location restriction is no longer a gap, so the
  // refreshed reason must not present it as missing.
  assert.doesNotMatch(program.judgeReason, /RIFT-357/);
  assert.doesNotMatch(program.judgeReason, /locationType/);
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "I cost :rb_energy_2: less to play from anywhere other than your hand.\n" +
      "Kill a unit at a battlefield."
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Drag Under structure: Action keyword, printed cost, cost-modify static ability", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "action" });

  // "I cost 2 less to play from anywhere other than your hand" — the printed
  // cost is 5 energy + 1 Order power (deck-catalog); the reduction is declared
  // as a static cost modification consumed at Finalize.
  assert.equal(costModification.kind, "static");
  assert.equal(costModification.effect.kind, "cost.modify");
  assert.equal(costModification.effect.resource, "energy");
  assert.deepEqual(costModification.effect.amount, { kind: "constant", value: -2 });
  assert.equal(costModification.effect.appliesTo, "self");
  assert.equal(costModification.effect.fromZone, "not-hand");

  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 5 },
    power: { kind: "constant", value: 1 }
  });
});

test("Drag Under structure: 'Kill a unit at a battlefield' is one located-unit target", () => {
  assert.equal(play.body.length, 1);
  assert.equal(killInstruction.id, "drag-under.kill");
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args.target, { kind: "constant", value: "drag-under.unit" });
  assert.equal(killInstruction.linkedTo, undefined);

  assert.equal(killInstruction.targets.length, 1);
  const [target] = killInstruction.targets;
  assert.equal(target.id, "drag-under.unit");
  assert.equal(target.selection, "one");
  // 355.10.b: the unit is the single target and "at a battlefield" is its
  // location restriction, expressed with the merged TargetSpec.location
  // filter (RIFT-357) so no battlefield is declared as a second target.
  assert.deepEqual(target.filter, { type: "unit" });
  assert.deepEqual(target.location, { type: "battlefield" });
});

test("Drag Under golden: the kill half kills the locked battlefield unit", () => {
  const kernel = world()
    .unit("victim", { owner: "B", might: 4, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const locked = kernel.ref("victim");
  const run = runInstruction(kill, { target: "drag-under.unit" }, {
    world: kernel,
    targets: { "drag-under.unit": [locked] }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.killed, [locked]);
  assert.equal(kernel.getObject("victim").zone, "trash");
});

test("Drag Under golden: a unit that left the battlefield makes the instruction ignored", () => {
  const kernel = world()
    .unit("victim", { owner: "B", might: 4, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const stale = kernel.ref("victim");
  kernel.perform({ type: "return-to-hand", object: stale });
  const run = runInstruction(kill, { target: "drag-under.unit" }, {
    world: kernel,
    targets: { "drag-under.unit": [stale] }
  });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
});

test("Drag Under golden: the printed location restriction really selects only a battlefield unit", () => {
  // 355.10.b / 355.10.d.2: "a unit at a battlefield" always targets the unit,
  // and "at a battlefield" is a restriction on it. The merged TargetSpec
  // location filter is what the production target translation now preserves.
  const translated = translateInstructionTargets(play.body);
  assert.deepEqual(translated[0].targets[0].filter, { type: "unit" });
  assert.deepEqual(translated[0].targets[0].location, { type: "battlefield" });

  const build = () => world()
    .unit("field-unit", { owner: "B", controller: "B", might: 4, location: { type: "battlefield", id: "battlefield-1" } })
    .unit("base-unit", { owner: "B", controller: "B", might: 4, location: { type: "base", player: "B" } })
    .build();

  const legal = build();
  legal.setTargets("drag-under.unit", [legal.ref("field-unit")]);
  const killed = resolveChainBody(play.body, legal);
  assert.equal(killed.status, "executed");
  assert.equal(legal.getObject("field-unit").zone, "trash");
  assert.equal(legal.getObject("base-unit").zone, "board");
  assert.deepEqual(killed.events.map((event) => event.action), ["kill"]);

  // A locked unit that stays at a Base does not satisfy the printed
  // restriction, so the instruction is ignored instead of killing it.
  const illegal = build();
  illegal.setTargets("drag-under.unit", [illegal.ref("base-unit")]);
  const missed = resolveChainBody(play.body, illegal);
  assert.equal(missed.status, "partial");
  assert.equal(missed.results[0].result.status, "ignored");
  assert.equal(illegal.getObject("base-unit").zone, "board");
  assert.deepEqual(missed.events, []);
});

test("Drag Under: the production binder exposes the printed cost.modify source", () => {
  const f = fixture({ cards: [{ id: "drag-under", cardId: program.canonicalCardId, types: ["spell"], energy: 5 }] });
  const source = f.kernel.getObject("drag-under");
  const handle = createEngineStaticBinder(f.engine).bindStatic(costModification, source);
  const [binding] = staticCostSources(f.engine);
  assert.equal(binding.ability.effect.kind, "cost.modify");
  assert.equal(binding.ability.effect.fromZone, "not-hand");
  handle.unbind();
  assert.deepEqual(staticCostSources(f.engine), []);
});

test("Drag Under golden: the merged cost.modify really reduces the printed energy at plan time", () => {
  // CR 366.2: the printed reduction is a Finalize discount. The merged
  // instruction freezes a real cost plan with the -2 energy discount applied;
  // wiring that plan into the production play pipeline is the recorded gap.
  const base = world()
    .player("A", { energy: 20 })
    .hand("drag-under", { types: ["spell"], energy: 5, power: ["Order"] })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("drag-under") });
  const run = runInstruction(
    costModify,
    {
      id: "drag-under.cost-plan",
      printed: { id: "drag-under", cardType: "Spell", energy: 5, power: 1, domains: ["Order"] },
      modifier: {
        kind: "reduce",
        resource: costModification.effect.resource,
        amount: { kind: "arithmetic", operator: "neg", operands: [costModification.effect.amount] }
      }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  const plan = run.linked["cost"];
  assert.equal(plan.total.energy, 3);
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: ["Order"] }]);
  assert.deepEqual(plan.discounts.map((entry) => [entry.id, entry.before, entry.after]), [
    ["drag-under.cost-plan:modifier:0", 5, 3]
  ]);
  assert.equal(plan.player, "A");
});

test.todo(
  "Drag Under cost reduction: playing this spell from anywhere other than the hand reduces its " +
    "printed 5 energy by 2 at Finalize (CR 366.2 / 356.4) — the static effect still has no layer " +
    "mapping in programs/statics.ts, and chain/engine.ts does not pass the pre-play origin plus " +
    "the card static into CostPlanInput.discounts"
);
