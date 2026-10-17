// Golden test for Mordekaiser, Twice Slain (rad-020-167).
//
// Supported bodies and keyword costs are tested independently. Recall,
// card-level optional/frequency metadata and Accelerate payment gating stay judged.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/mordekaiser-twice-slain.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import accelerate from "../../../../engine-core/dist/effects/keywords/Accelerate.js";
import assault from "../../../../engine-core/dist/effects/keywords/Assault.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { buildAdditionalCostPlan, payAdditionalCostPlan } from "../../../../engine-core/dist/cost/kinds/additional.js";

const CANONICAL =
  "card.hash-f7168f36176ada340afa90fee63698e923fee7c44c455b65ba0fa4cf1b747c7e";
const SOURCE_TEXT =
  "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
  "[Assault 3] (+3 :rb_might: while I'm an attacker.)\n" +
  "Once each turn, if I would die, you may kill a friendly unit to heal me, exhaust me, and recall me instead.";
const HOST = { canonicalCardId: CANONICAL };

const [accelerateKeyword, assaultKeyword, replacement] = program.abilities;
const [killInstruction, healInstruction, exhaustInstruction, recallInstruction] = replacement.with;

test("rad-020-167 Mordekaiser, Twice Slain: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-020-167 Mordekaiser, Twice Slain: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-020-167 Mordekaiser, Twice Slain: judgeReason names selection, Recall, metadata and Accelerate gating", () => {
  assert.match(program.judgeReason, /355\.10\.c\.1/);
  assert.match(program.judgeReason, /RIFT-358/);
  assert.match(program.judgeReason, /Recall/);
  assert.match(program.judgeReason, /optional\/oncePerTurn/);
  assert.match(program.judgeReason, /accelerate\.cost/);
});

test("rad-020-167 Mordekaiser, Twice Slain: Accelerate + Assault 3 declared in printed order", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(accelerateKeyword, { kind: "keyword", keyword: "accelerate" });
  assert.deepEqual(assaultKeyword, { kind: "keyword", keyword: "assault", value: 3 });
  // CR 807.2 / 805: both keywords' values live on the keyword declarations.
  assert.equal(keywordDefinitionsById.get("Accelerate"), accelerate);
  assert.equal(keywordDefinitionsById.get("Assault"), assault);
  assert.equal(assault.stacking, "sum");
  assert.ok(accelerate.ruleRefs.includes("805.1.b"));
  assert.ok(assault.ruleRefs.includes("807.1.c"));
});

test("rad-020-167 Mordekaiser, Twice Slain: Assault 3 really expands to a +3 arithmetic-layer Might effect", () => {
  const [expansion] = assault.expand({ value: assaultKeyword.value, host: HOST });
  assert.equal(expansion.kind, "static");
  // 807.1.c: the expansion is the merged continuous.might shape consumed by the
  // arithmetic layer while the Attacker designation holds.
  assert.equal(expansion.effect.kind, "continuous.might");
  assert.equal(expansion.effect.mode, "add");
  assert.equal(expansion.effect.layer, "arithmetic");
  assert.deepEqual(expansion.effect.amount, { kind: "constant", value: 3 });
  assert.equal(expansion.effect.appliesTo, "self");
  assert.equal(expansion.condition.kind, "compare");
  assert.equal(expansion.condition.operator, "eq");
  assert.equal(expansion.condition.left.property, "designation");
  assert.deepEqual(expansion.condition.right, { kind: "constant", value: "attacker" });
});

test("rad-020-167 Mordekaiser, Twice Slain: the replacement intercepts its own death", () => {
  assert.equal(replacement.kind, "replacement");
  // "if I would die" — the replaced event is this source unit being killed (429.1).
  assert.deepEqual(replacement.replaces, {
    event: "object-killed",
    filter: { source: "self" }
  });
  assert.equal(replacement.with.length, 4);
  assert.deepEqual(
    replacement.with.map((instruction) => instruction.id),
    [
      "mordekaiser.kill-friendly",
      "mordekaiser.heal-self",
      "mordekaiser.exhaust-self",
      "mordekaiser.recall-self"
    ]
  );
});

test("rad-020-167 Mordekaiser, Twice Slain: 'kill a friendly unit' is a non-target pick (355.10.c.1)", () => {
  assert.equal(killInstruction.op, "effect.kill");
  // 355.10.c.1: "[do X] to [do Y]" costs inside an instruction do not target.
  assert.deepEqual(killInstruction.args, {
    picks: { kind: "constant", value: "mordekaiser.friendly-unit" }
  });
  assert.equal(killInstruction.targets, undefined);
  assert.equal(killInstruction.picks.length, 1);
  const [pick] = killInstruction.picks;
  assert.equal(pick.id, "mordekaiser.friendly-unit");
  assert.equal(pick.min, 1);
  assert.equal(pick.max, 1);
  assert.equal(pick.selection, "one");
  assert.deepEqual(pick.filter, {
    type: "unit",
    zone: "board",
    controller: "self"
  });
});

test("rad-020-167 Mordekaiser, Twice Slain: heal me → exhaust me → recall me, in printed order", () => {
  // "heal me" (419.1) — effect.heal's default selection is the ability source.
  assert.equal(healInstruction.op, "effect.heal");
  assert.deepEqual(healInstruction.args, {});
  assert.equal(healInstruction.linkedTo, "mordekaiser.kill-friendly");

  // "exhaust me" (415.1) — the source is anchored symbolically, never as a target.
  assert.equal(exhaustInstruction.op, "effect.exhaust");
  assert.deepEqual(exhaustInstruction.args.choose, {
    kind: "constant",
    value: { id: "mordekaiser.exhaust-me", filter: { source: "source" } }
  });
  assert.equal(exhaustInstruction.linkedTo, "mordekaiser.heal-self");

  // "recall me instead" (457/458/458.3/460.1) — declared, blocked by the primitive.
  assert.equal(recallInstruction.op, "effect.move");
  assert.deepEqual(recallInstruction.args.mode, { kind: "constant", value: "recall" });
  assert.deepEqual(recallInstruction.args.to, { kind: "constant", value: "controller-base" });
  assert.equal(recallInstruction.linkedTo, "mordekaiser.exhaust-self");
});

test("rad-020-167 Mordekaiser, Twice Slain: kill + heal + exhaust really resolve through the interpreter", () => {
  const kernel = world()
    .unit("mordekaiser", { might: 5, damage: 3 })
    .unit("ally", { might: 2 })
    .unit("enemy", { owner: "B", might: 3 })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("mordekaiser") });
  scoped.setPicks("mordekaiser.friendly-unit", [scoped.ref("ally")]);

  // Execute the original supported prefix, preserving every pick and link.
  const outcome = runAbilityBody(replacement.with.slice(0, 3), scoped);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [
      ["mordekaiser.kill-friendly", "executed"],
      ["mordekaiser.heal-self", "executed"],
      ["mordekaiser.exhaust-self", "executed"]
    ]
  );
  // 429.1: the friendly unit really dies; 419.1 clears the marked damage on Mordekaiser.
  assert.equal(scoped.getObject("ally").zone, "trash");
  assert.equal(scoped.getObject("mordekaiser").damage, 0);
  // 415.1: the source is exhausted; the unrelated enemy unit is untouched.
  assert.equal(scoped.getObject("mordekaiser").exhausted, true);
  assert.equal(scoped.getObject("enemy").exhausted, false);
});

test("rad-020-167 Mordekaiser, Twice Slain: an already-exhausted source stays exhausted with no extra action (415.1.c)", () => {
  const kernel = world().unit("mordekaiser", { might: 5, damage: 3, exhausted: true })
    .unit("ally", { might: 2 }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("mordekaiser") });
  scoped.setPicks("mordekaiser.friendly-unit", [scoped.ref("ally")]);
  const outcome = runAbilityBody(replacement.with.slice(0, 3), scoped);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[2].result.status, "executed");
  assert.equal(outcome.results[2].result.linkedValues["exhausted"].alreadyExhausted, 1);
  assert.deepEqual(outcome.events.map(event => event.action), ["kill", "heal"]);
  assert.equal(scoped.getObject("mordekaiser").exhausted, true);
});

test("rad-020-167 Mordekaiser, Twice Slain: the supported prefix heals and exhausts the source without moving it", () => {
  const kernel = world().unit("mordekaiser", { might: 5, damage: 3 })
    .unit("ally", { might: 2 }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("mordekaiser") });
  const before = scoped.getObject("mordekaiser");
  scoped.setPicks("mordekaiser.friendly-unit", [scoped.ref("ally")]);
  const outcome = runAbilityBody(replacement.with.slice(0, 3), scoped);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.events.map(event => event.action), ["kill", "heal", "exhaust"]);
  assert.equal(scoped.getObject("mordekaiser").damage, 0);
  assert.equal(scoped.getObject("mordekaiser").exhausted, true);
  assert.deepEqual(scoped.getObject("mordekaiser").location, before.location);
  assert.deepEqual(scoped.getObject("mordekaiser").ref, before.ref);
});

test("rad-020-167 Mordekaiser, Twice Slain: the Recall intent remains declared for the distinct action adapter", () => {
  // 457-460: Recall is not a Move. The program records the intent with the
  // move spelling plus mode "recall"; the merged replacement planner documents
  // that this exact mode is blocked (README "Supported planned opcodes" lists
  // effect.move with "mode recall is blocked, CR 457-460"). The gap stays in
  // judgeReason and the todos instead of being pinned by a throw assertion.
  assert.equal(recallInstruction.op, "effect.move");
  assert.deepEqual(recallInstruction.args.mode, { kind: "constant", value: "recall" });
  assert.deepEqual(recallInstruction.args.to, { kind: "constant", value: "controller-base" });
  assert.deepEqual(recallInstruction.args.objects, { kind: "constant", value: "source" });
});

test("rad-020-167 Mordekaiser, Twice Slain: the within-cost kill stays a non-target pick, never a target", () => {
  // 355.10.c.1: the kill is a within-cost action, so the program declares it
  // with args.picks and gives the instruction no TargetSpec. That shape is a
  // durable property of the card; how the replacement layer plans it is the
  // gap recorded in judgeReason.
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args, {
    picks: { kind: "constant", value: "mordekaiser.friendly-unit" }
  });
  assert.equal(killInstruction.targets, undefined);
  assert.equal(killInstruction.picks.length, 1);
  assert.deepEqual(killInstruction.picks[0].filter, {
    type: "unit",
    zone: "board",
    controller: "self"
  });

  // The pick still resolves through the merged interpreter for the static body.
  const kernel = world().unit("mordekaiser", { might: 5 }).unit("ally", { might: 2 }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("mordekaiser") });
  scoped.setPicks("mordekaiser.friendly-unit", [scoped.ref("ally")]);
  const run = runAbilityBody([killInstruction], scoped);
  assert.equal(run.results[0].result.status, "executed");
  assert.equal(scoped.getObject("ally").zone, "trash");
});

test.todo('Mordekaiser, Twice Slain: select and pay a friendly-unit sacrifice inside the replacement, with payment failure gating (CR 355.10.c.1, RIFT-358).');
test.todo('Mordekaiser, Twice Slain: execute Recall as a distinct relocation preserving statuses and bypassing movement restrictions (CR 457-460).');
test.todo('Mordekaiser, Twice Slain: bind the replacement optional/oncePerTurn fields and connect Accelerate selected costs to entry orientation (CR 805.2.b).');

test("Mordekaiser, Twice Slain: Accelerate costs really lock and pay the additional Fury Power", () => {
  const kernel = world().player("A", { energy: 8, power: ["Fury", "Fury"] })
    .hand("mordekaiser", { types: ["unit"], energy: 7, power: ["Fury"], might: 5 }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("mordekaiser") });
  const [costAbility] = accelerate.expand({ host: HOST });
  const plan = buildAdditionalCostPlan(scoped, { id: "morde:accelerate", cost: { kind: "printed" }, domains: scoped.source.power }, [{
    id: "accelerate", kind: "accelerate", selected: true,
    cost: { payments: costAbility.effect.cost.payments }
  }]);
  assert.equal(plan.total.energy, 8);
  assert.deepEqual(plan.total.power, [
    { amount: 1, allowedDomains: ["Fury"] }, { amount: 1, allowedDomains: ["Fury"] }
  ]);
  const receipt = payAdditionalCostPlan(scoped, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.additional, [{ id: "accelerate", kind: "accelerate", paid: true }]);
  assert.deepEqual(receipt.actions[0].action.plan.power, ["Fury", "Fury"]);
  assert.equal(scoped.player("A").energy, 0);
  assert.equal(scoped.getObject("mordekaiser").zone, "hand");
});
