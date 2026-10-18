import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/fox-fire-ahri.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { buildHiddenKindCostPlan, payHiddenCostPlan } from "../../../../engine-core/dist/cost/kinds/index.js";
import { DUEL_DOMAINS } from "../../../../engine-core/dist/cost/resources.js";

const CARD_ID = "card.hash-a8491bd5b3202938d1600eec9d2435158dffdf3ceda1be6ceaa50336f2e25393";

const keywords = program.abilities.filter(ability => ability.kind === "keyword");
const play = program.abilities.find(ability => ability.kind === "play");
const killInstruction = play.body[0];
const targetSpec = killInstruction.targets[0];

test("ogn-256-298 Fox-Fire: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
      "[Action] (Play on your turn or in showdowns.)\n" +
      "Kill any number of units at a battlefield with total Might 4 or less."
  );
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-256-298 Fox-Fire judgeReason names the group and total-Might gap", () => {
  assert.match(program.judgeReason, /355\.11/);
  assert.match(program.judgeReason, /total Might/);
  assert.match(program.judgeReason, /同一战场/);
  assert.match(program.judgeReason, /target-plan\.ts 没有任何执行路径/);
  assert.match(program.judgeReason, /keywords\/Hidden\.ts 仍标记 RIFT-89\/RIFT-91 待办/);
  assert.match(program.judgeReason, /cost\.hidden/);
});

test("ogn-256-298 Fox-Fire structure: [Hidden] + [Action] and an any-number group kill", () => {
  assert.deepEqual(keywords, [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" }
  ]);
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.equal(play.body.length, 1);

  assert.equal(killInstruction.id, "fox-fire-kill");
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args.target, { kind: "literal", value: "fox-fire-units" });
  assert.equal(killInstruction.linkedTo, undefined);

  // "any number ... at a battlefield": 355.13 lets the controller choose zero
  // targets, and kind:"group" is a declared field: the target-plan reader has
  // no execution path for group consistency or a total-Might sum (see judgeReason).
  assert.equal(killInstruction.targets.length, 1);
  assert.equal(targetSpec.id, "fox-fire-units");
  assert.deepEqual(targetSpec.filter, { type: "unit", zone: "board" });
  assert.deepEqual(targetSpec.location, { type: "battlefield" });
  assert.equal(targetSpec.selection, "any");
  assert.equal(targetSpec.min, 0);
  assert.equal(targetSpec.max, null);
  assert.equal(targetSpec.kind, "group");
  assert.equal(killInstruction.picks, undefined);
});

test("ogn-256-298 Fox-Fire golden: the kill half kills exactly the group members locked at Finalize", () => {
  const kernel = world()
    .unit("first-unit", { location: { type: "battlefield", id: "battlefield-1" } })
    .unit("second-unit", { location: { type: "battlefield", id: "battlefield-1" } })
    .unit("unlocked-unit", { location: { type: "battlefield", id: "battlefield-2" } })
    .build();
  const locked = [kernel.ref("first-unit"), kernel.ref("second-unit")];

  const run = runInstruction(kill, { target: targetSpec.id }, { world: kernel, targets: { [targetSpec.id]: locked } });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("first-unit").zone, "trash");
  assert.equal(kernel.getObject("second-unit").zone, "trash");
  assert.equal(kernel.getObject("unlocked-unit").zone, "board");
  assert.equal(run.events.filter(event => event.action === "kill").length, 2);
});

test("ogn-256-298 Fox-Fire golden: TargetSpec.location revalidates battlefield membership", () => {
  const kernel = world()
    .unit("battlefield-unit", { location: { type: "battlefield", id: "battlefield-1" } })
    .unit("base-unit", { location: { type: "base", player: "A" } })
    .build();
  kernel.setTargets(targetSpec.id, [kernel.ref("battlefield-unit"), kernel.ref("base-unit")]);

  const outcome = resolveChainBody([killInstruction], kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["fox-fire-kill", "executed"]
  ]);
  assert.equal(kernel.getObject("battlefield-unit").zone, "trash");
  assert.equal(kernel.getObject("base-unit").zone, "board");
  assert.deepEqual(outcome.events.map(event => event.action), ["kill"]);
});

test("ogn-256-298 Fox-Fire golden: choosing zero units is legal for any-number targeting (355.13)", () => {
  const kernel = world().unit("untouched-unit").build();
  const run = runInstruction(kill, { target: targetSpec.id }, { world: kernel, targets: { [targetSpec.id]: [] } });

  // With an empty selection there is nothing to kill: the instruction is ignored
  // (359.3.e) and no unit dies.
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(kernel.getObject("untouched-unit").zone, "board");
  assert.equal(run.events.length, 0);
});

test("ogn-256-298 Fox-Fire golden: the merged Hidden cost planner locks the hide plan and the play plan ignores the printed base", () => {
  // The [Hidden] keyword cost side is merged (cost/kinds/hidden.ts); this
  // executes the real planner + payer for both modes. The kill half above
  // stays the blocked part (judgeReason); the 811.1.c/811.1.d flow binding
  // (Hide action, facedown zone, next-turn Reaction play) is not wired.
  const fixture = () => {
    const kernel = world()
      .player("A", { energy: 20, power: ["Fury"] })
      .hand("fox-fire", { types: ["spell"], energy: 3, power: null })
      .build();
    return kernel.clone({ sourceSnapshot: kernel.getObject("fox-fire") });
  };

  const hideContext = fixture();
  const hidePlan = buildHiddenKindCostPlan(hideContext, { id: "fox-fire:hide", mode: "hide" });
  assert.deepEqual(hidePlan.total.power, [{ amount: 1, allowedDomains: DUEL_DOMAINS }]);
  assert.equal(hidePlan.total.energy, 0);
  assert.equal(hidePlan.printed.energy, 3);
  assert.equal(hidePlan.printed.power, null);
  const hideReceipt = payHiddenCostPlan(hideContext, hidePlan);
  assert.equal(hideReceipt.paid, true);
  assert.deepEqual(hideReceipt.actions[0].action.plan.power, ["Fury"]);

  const playContext = fixture();
  const playPlan = buildHiddenKindCostPlan(playContext, { id: "fox-fire:play", mode: "play" });
  assert.equal(playPlan.printed.energy, 3);
  assert.equal(playPlan.total.energy, 0);
  const playReceipt = payHiddenCostPlan(playContext, playPlan);
  assert.equal(playReceipt.paid, true);
});
