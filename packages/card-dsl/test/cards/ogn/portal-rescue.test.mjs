import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/portal-rescue.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import banish from "../../../../engine-core/dist/effects/instructions/effect.banish.js";
import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import play from "../../../../engine-core/dist/effects/instructions/effect.play.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-9595373fe14cedf30b615fbf8b92e3f4477e887d643fbebe7041a8501669ee50";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Banish a friendly unit, then play it to base, ignoring its cost.";

const [actionKeyword, playAbility] = program.abilities;
const [banishFriendlyUnit, playToBase] = playAbility.body;
const targetSpec = banishFriendlyUnit.targets[0];

/** The reference kernel compares filter values literally, so the card layer's
 * friendly placeholder is locked by the test harness (production resolves it
 * through the target pipeline, which the structural assertions cover). */
const bodyWithoutTargetSpecs = playAbility.body.map(({ targets, ...rest }) => rest);

test("ogn-102-298 Portal Rescue: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-102-298 Portal Rescue identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-102-298 Portal Rescue judgeReason names the merged arithmetic and the missing card-side producer", () => {
  // The reason cites the ignore-cost family (356.1.b) including the
  // both-resources branch 356.1.b.1, the 356.6 floor, the merged cost.modify /
  // ignore-base arithmetic and the remaining card-side producer gap.
  assert.match(program.judgeReason, /356\.1\.b\.1/);
  assert.match(program.judgeReason, /356\.1\.b/);
  assert.match(program.judgeReason, /356\.6/);
  assert.match(program.judgeReason, /FinalizedCostPlan/);
  assert.match(program.judgeReason, /ignore-base/);
  assert.match(program.judgeReason, /已合入/);
  assert.ok(!/RIFT-261/.test(program.judgeReason), "merged cost-op task must not stay a listed dependency");
  // The current gap is the card-side descriptor consumer, not the primitive.
  assert.match(program.judgeReason, /resolveChainBody/);
  assert.match(program.judgeReason, /费用描述符→Finalize 计划的卡牌侧消费接线/);
});

test("ogn-102-298 Portal Rescue structure: [Action] keyword plus a linked banish-then-play pair", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(actionKeyword, { kind: "keyword", keyword: "action" });
  assert.equal(actionKeyword.value, undefined);
  assert.equal(playAbility.kind, "play");
  assert.equal(playAbility.cost, undefined);
  assert.deepEqual(playAbility.body.map(instruction => instruction.id), [
    "portal-rescue.banish-friendly-unit",
    "portal-rescue.play-to-base"
  ]);

  // "Banish a friendly unit" — one Board unit controlled by this ability's
  // controller (355.7/355.9.a.1/355.9.b).
  assert.equal(banishFriendlyUnit.op, "effect.banish");
  assert.deepEqual(banishFriendlyUnit.args.objects, {
    kind: "constant",
    value: { target: "portal-rescue.friendly-unit" }
  });
  assert.deepEqual(targetSpec, {
    id: "portal-rescue.friendly-unit",
    filter: { type: "unit", controller: "self" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(banishFriendlyUnit.linkedTo, undefined);

  // "then play it to base, ignoring its cost" — the banished card's fresh
  // reference comes from the receipt (124: zone change makes a new object),
  // the destination is the acting side's base, and the cost argument records
  // the required finalization (both base costs zero, 356.1.b.1/356.6).
  assert.equal(playToBase.op, "effect.play");
  assert.equal(playToBase.linkedTo, "portal-rescue.banish-friendly-unit");
  assert.deepEqual(playToBase.args.object, {
    kind: "linked-value",
    instructionId: "portal-rescue.banish-friendly-unit",
    key: "banishedObject"
  });
  assert.deepEqual(playToBase.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  assert.deepEqual(playToBase.args.cost.value, {
    kind: "cost.modify",
    base: "printed",
    ignore: ["energy", "power"],
    minimum: 0,
    finalized: false
  });
  assert.equal(playToBase.targets, undefined);
});

test("ogn-102-298 Portal Rescue: the merged registry really registers both used primitives", () => {
  assert.equal(banish.op, "effect.banish");
  assert.equal(play.op, "effect.play");
  assert.equal(costModify.op, "cost.modify");
});

test("ogn-102-298 Portal Rescue golden: the merged cost.modify primitive really zeroes both base costs (356.1.b.1/356.6)", () => {
  // The merged primitive (RIFT-261) builds a finalized plan through
  // buildCostPlan + BaseCostModification ignore-base: resources. This is the
  // arithmetic the card's play half needs; only the card-side producer that
  // turns this card's cost descriptor into that plan is missing.
  const kernel = world()
    .unit("rescued", { owner: "A", controller: "A", types: ["unit"], energy: 3, power: ["Mind"] })
    .build();
  const run = runInstruction(costModify, {
    id: "portal-rescue.ignore-cost",
    cost: { kind: "explicit", energy: { kind: "constant", value: 3 }, power: { kind: "constant", value: ["Mind"] } },
    baseModifications: [{ kind: "ignore-base", ignore: "resources" }],
    linkKey: "plan"
  }, { world: kernel });

  assert.equal(run.result.status, "executed");
  const plan = run.linked.plan;
  assert.equal(plan.finalized, true);
  assert.deepEqual(plan.total, { energy: 0, power: [], xp: 0, actions: [] });
  assert.deepEqual(plan.modifications, [{ kind: "ignore-base", ignore: "resources" }]);
});

test("ogn-102-298 Portal Rescue golden: the banished unit reaches Banishment and its receipt carries the new ref", () => {
  const kernel = world().base("rescued", { owner: "A", types: ["unit"], might: 2 }).build();
  const original = kernel.ref("rescued");

  const run = runInstruction(banish, {
    objects: { kind: "constant", value: { target: targetSpec.id } },
    amount: { kind: "constant", value: 1 },
    linkKey: { kind: "constant", value: "banished" }
  }, { world: kernel, targets: { [targetSpec.id]: [original] } });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.banished.count, 1);
  // 124: the card left the Board, so the receipt's reference is the new
  // zone-entry identity, never a revived old one.
  assert.deepEqual(run.linked.banishedObject, { id: "rescued", zoneEntryId: 2 });
  assert.deepEqual(run.events.map(event => event.action), ["banish"]);
  assert.equal(kernel.getObject("rescued").zone, "banishment");
  assert.equal(kernel.object(original), null);
});

test("ogn-102-298 Portal Rescue golden: the banished card is not on the Board when the play half runs", () => {
  const kernel = world().base("rescued", { owner: "A", types: ["unit"], might: 2 }).build();
  kernel.setTargets(targetSpec.id, [kernel.ref("rescued")]);

  const outcome = resolveChainBody(bodyWithoutTargetSpecs, kernel);

  // The banish half executes; the play half negates because its cost argument
  // is not a finalized plan (judgeReason) — it is never played at the printed
  // cost, and the linked reference is read from the receipt.
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["portal-rescue.banish-friendly-unit", "executed"],
    ["portal-rescue.play-to-base", "negated"]
  ]);
  assert.deepEqual(outcome.results[1].result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(kernel.getObject("rescued").zone, "banishment");
  assert.equal(outcome.linkedValues["portal-rescue.banish-friendly-unit.banishedObject"].zoneEntryId, 2);
  assert.deepEqual(outcome.events.map(event => event.action), ["banish"]);
});

test("ogn-102-298 Portal Rescue golden: a banish that cannot happen leaves the linked play ignored too (359.3.e.14)", () => {
  const kernel = world().base("rescued", { owner: "A", types: ["unit"], might: 2 }).build();
  const stale = kernel.ref("rescued");
  // The unit already left the Board after finalization.
  kernel.perform({ type: "return-to-hand", object: stale });
  kernel.setTargets(targetSpec.id, [stale]);

  const outcome = resolveChainBody(bodyWithoutTargetSpecs, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(result => result.result), [
    { status: "ignored", reason: "mistargeted" },
    { status: "ignored", reason: "linked-ignored" }
  ]);
  assert.equal(kernel.getObject("rescued").zone, "hand");
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["rescued"]);
});

test("ogn-102-298 Portal Rescue golden: an unfinalized ignore-cost plan never plays at the printed cost", () => {
  // Guards against the wrong fix: effect.play must reject the descriptor
  // instead of charging the printed cost.
  const kernel = world()
    .object("rescued", { zone: "banishment", types: ["unit"], owner: "A", controller: "A", energy: 5, power: ["Fury"] })
    .build();
  const banished = kernel.zone("A", "banishment")[0];

  const run = runInstruction(play, {
    object: { kind: "constant", value: banished },
    location: playToBase.args.location,
    cost: playToBase.args.cost
  }, { world: kernel });

  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(kernel.getObject("rescued").zone, "banishment");
  assert.equal(run.events.length, 0);
});

test.todo(
  "Portal Rescue: the merged cost.modify arithmetic must be reachable from this card's IR - the production " +
    "chain dispatch (chain/interpreter-adapter.ts primitiveArgs LITERAL_FIELDS) does not decode a card-side " +
    "cost.modify, so its Expr id/args are rejected, and the plan has to be built from the banished card's own " +
    "printed Energy/Power cost (CR 356.1.b.1, floor 0 per 356.6) for the play to base as a Limited Action " +
    "(420.3/420.3.a). Depends on the card-side cost-descriptor to Finalize cost-plan consumer."
);

test.todo(
  "Portal Rescue: [Action] admission (806.1.b) plus Finalize-time target locking and the Resolve-time " +
    "re-verification of the friendly unit (355.8/355.15, 359.3.e) belong to the chain and target batches"
);
