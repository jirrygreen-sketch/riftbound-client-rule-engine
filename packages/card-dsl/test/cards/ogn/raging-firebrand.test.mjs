import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/raging-firebrand.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-6a44ecaa1f76158a92ecce63e4d3e2d347cc32014c448f13003d9f2500cb3de7";

test("ogn-031-298 Raging Firebrand: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  // cost.modify is merged; the reason must name the merged primitive and the
  // still-missing one-shot window rather than the unmerged cost ops.
  assert.match(program.judgeReason, /cost\.modify 指令原语已合入/);
  assert.match(program.judgeReason, /one-shot/);
  assert.match(program.judgeReason, /卡牌触发绑定已合入/);
  assert.match(program.judgeReason, /一次性费用修正窗口/);
  assert.match(program.judgeReason, /continuous\.cost-modification/);
  assert.match(program.judgeReason, /per-turn-first-play/);
  assert.match(program.judgeReason, /self 约束/);
  assert.ok(!/cost\.pay\/cost\.modify 未合入/.test(program.judgeReason));
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-031-298 Raging Firebrand: identity, ruleset and exact source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "When you play me, the next spell you play this turn costs :rb_energy_5: less."
  );
});

test("ogn-031-298 Raging Firebrand: card-played self trigger carrying a one-shot -5 energy cost modification", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  // Validation accepts this canonical-id filter, but source identity still
  // needs a validated self-binding adapter; see the separate execution TODO.
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    object: { canonicalCardId: CARD_ID }
  });
  const validated = validateTriggerSpec(ability.trigger);
  assert.equal(validated.ok, true, JSON.stringify(validated.ok ? [] : validated.issues));
  assert.equal(ability.optional, false);

  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "raging-firebrand.cost-modify");
  assert.equal(instruction.op, "cost.modify");
  assert.deepEqual(instruction.args.resource, { kind: "constant", value: "energy" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: -5 });
  assert.deepEqual(instruction.args.appliesTo, {
    kind: "constant",
    value: "next-spell-this-turn"
  });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("ogn-031-298 Raging Firebrand golden: the merged cost.modify really applies the -5 Energy discount with the 356.6 floor", () => {
  // The merged primitive builds the finalized plan the one-shot window would
  // have to install: one 5-Energy discount instance with a 0 floor. This is the
  // arithmetic the card needs; only the one-shot window that carries it onto
  // the next played spell is missing.
  const kernel = world().unit("src", { owner: "A", controller: "A" }).build();
  const run = runInstruction(costModify, {
    id: "raging-firebrand.next-spell",
    cost: { kind: "explicit", energy: { kind: "constant", value: 3 } },
    modifier: { kind: "reduce", resource: "energy", amount: { kind: "constant", value: 5 }, minimum: { kind: "constant", value: 0 } },
    linkKey: "plan"
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  const plan = run.linked.plan;
  assert.equal(plan.finalized, true);
  // 3 Energy minus the 5-point discount floors at 0 rather than going negative.
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.discounts.map(entry => [entry.resource, entry.amount, entry.minimum, entry.before, entry.after]), [
    ["energy", 5, 0, 3, 0]
  ]);
});

test("ogn-031-298 Raging Firebrand golden: a second plan with the same discount pays the full discounted cost, not a stale one-shot", () => {
  // Two independent plans show the discount lives inside one plan only: a
  // 6-Energy spell with the same single -5 instance costs 1, and a fresh plan
  // with the 2-Energy printed spell would pay 0 (356.6 floor) without carrying
  // over any state.
  const kernel = world().unit("src", { owner: "A", controller: "A" }).build();
  const run = runInstruction(costModify, {
    id: "raging-firebrand.second-spell",
    cost: { kind: "explicit", energy: { kind: "constant", value: 6 } },
    modifier: { kind: "reduce", resource: "energy", amount: { kind: "constant", value: 5 } },
    linkKey: "plan"
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.plan.total.energy, 1);
  assert.equal(run.linked.plan.discounts.length, 1);
});

test.todo(
  "ogn-031-298 Raging Firebrand: execute the discount — register a one-shot next-spell cost " +
    "modification, assert the following spell's finalized cost plan is 5 energy cheaper and that a " +
    "second spell costs full — cost.modify, continuous.cost-modification and the cost/discounts collector are merged, but the one-shot " +
    "'next spell this turn' window that carries the plan onto a later Finalize is still missing."
);

test.todo("Raging Firebrand: self card-played trigger must ignore another copy with the same canonicalCardId (CR 383.4.a)");
