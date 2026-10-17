import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/zed-from-the-shadows.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import tokenPrimitive from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-d7b6ea328eac7b13a0a652c5d95b38895d7026cbb51f23007ecdce1f9a3d951c";
const SOURCE_TEXT =
  "You may discard 1 as an additional cost to play me.\n" +
  "When you play me, if you paid the additional cost, play a 0 :rb_might: Shadow Clone unit token. " +
  "(It has \"When I attack, you may banish a unit from your trash. If you do, give me [Assault 4] this turn.\")";

const [additionalCost, playEffect] = program.abilities;
const [playToken] = playEffect.body;

test("ven-023-166 Zed, From the Shadows: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-023-166 Zed: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /condition\.result/);
  assert.match(program.judgeReason, /describePlay/);
  assert.match(program.judgeReason, /CostPlanInput/);
  assert.match(program.judgeReason, /ObjectRef/);
  assert.match(program.judgeReason, /合法地点|地点候选|地点集合/);
  assert.doesNotMatch(program.judgeReason, /translateCost/);
  assert.doesNotMatch(program.judgeReason, /冻结 IR 没有 condition\.result/);
  assert.doesNotMatch(program.judgeReason, /RIFT-/);
  assert.match(program.judgeReason, /effect\.token/);
  assert.match(program.judgeReason, /187\.11/);
});

test("ven-023-166 Zed: the optional additional cost discards 1 as a non-target choice", () => {
  // 356.2.b / 356.2.b.1: an Optional Additional Cost declared by the played
  // card's own passive ability, charged in cost step 2 (356.2.a).
  assert.equal(additionalCost.kind, "static");
  assert.equal(additionalCost.effect.kind, "cost.additional");
  assert.equal(additionalCost.effect.id, "zed.additional-cost");
  assert.equal(additionalCost.effect.appliesTo, "self");
  assert.equal(additionalCost.effect.optional, true);
  assert.equal(additionalCost.effect.stage, "optional-additional");
  assert.deepEqual(additionalCost.effect.payments.map((payment) => payment.kind), ["discard"]);
  const [payment] = additionalCost.effect.payments;
  assert.deepEqual(payment.amount, { kind: "constant", value: 1 });
  // 355.10.c / 423.1.a: a card discarded as part of a cost is not a target, so
  // the component carries a non-target pick rather than a TargetSpec.
  assert.equal(payment.choice.id, "zed.discarded-card");
  assert.deepEqual(payment.choice.filter, {
    type: "card",
    zone: "hand",
    owner: "controller"
  });
  assert.equal(payment.choice.selection, "one");
});

test("ven-023-166 Zed: the play effect is gated on the paid-cost receipt", () => {
  assert.equal(playEffect.kind, "triggered");
  assert.equal(playEffect.optional, false);
  assert.equal(playEffect.trigger.at, "card-played");
  assert.deepEqual(playEffect.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  // 356.4.f.1: "if you paid the additional cost" reads the finalized
  // CostPlan/payment receipt. CardProgram -> Finalize production binding is
  // still missing, but this condition itself is executable by the interpreter.
  assert.deepEqual(playEffect.trigger.condition, {
    kind: "result",
    result: "additional-cost-paid",
    id: "zed.additional-cost"
  });
});

test("ven-023-166 Zed: the body plays the Shadow Clone token with no invented location", () => {
  assert.deepEqual(playEffect.body.map((instruction) => instruction.id), ["zed.play-shadow-clone"]);
  assert.equal(playToken.op, "effect.token");
  // 187.11: the printed 0-Might Shadow Clone token (with its own attack ability)
  // is not in effect.token's frozen definition table.
  assert.deepEqual(playToken.args.token, { kind: "constant", value: "shadow-clone" });
  assert.deepEqual(playToken.args.amount, { kind: "constant", value: 1 });
  // 440.2.c / 185.2.a / 350.2 / 354: a played token is created on the Chain first.
  assert.deepEqual(playToken.args.mode, { kind: "constant", value: "play" });
  // 355.2/355.2.a: the legal destinations are a Finalize choice; the card data
  // never pins a location (no `location`, `target`, `pick` or `locations` arg).
  assert.equal(playToken.args.location, undefined);
  assert.equal(playToken.args.locations, undefined);
  assert.equal(playToken.args.target, undefined);
  assert.equal(playToken.args.pick, undefined);
  assert.equal(playToken.linkedTo, undefined);
  assert.equal(playToken.targets, undefined);
});

test("ven-023-166 Zed: the token identity is the printed Shadow Clone, never a substituted token", () => {
  // CR 187.11 names this exact token; the card does not swap in a different
  // definition so that the body would run.
  assert.equal(playToken.args.token.value, "shadow-clone");
  assert.notEqual(playToken.args.token.value, "recruit");
  assert.notEqual(playToken.args.token.value, "reflection");
});

test("ven-023-166 Zed golden: condition.result reads the paid and declined additional-cost receipts", () => {
  const runGate = (selected) => {
    const kernel = world()
      .player("A", { energy: 4, power: ["Fury"] })
      .hand("zed", { owner: "A", types: ["unit"], energy: 4, power: ["Fury"] })
      .hand("discard-me", { owner: "A" })
      .build();
    kernel.setAnswers({
      ["zed-cost:pick:" + paymentChoiceId]: [kernel.ref("discard-me")]
    });
    const context = kernel.clone({ sourceSnapshot: kernel.getObject("zed") });
    const plan = buildCostPlan(context, {
      id: "zed-cost",
      cost: {
        kind: "explicit",
        energy: { kind: "constant", value: 4 },
        power: { kind: "constant", value: ["Fury"] }
      },
      optionalAdditional: [{
        id: additionalCost.effect.id,
        kind: "additional",
        selected,
        cost: {
          kind: "explicit",
          payments: [{
            kind: "discard",
            choice: {
              id: paymentChoiceId,
              options: [context.ref("discard-me")],
              min: 1,
              max: 1,
              selection: "one"
            }
          }]
        }
      }]
    });
    const receipt = payCostPlan(context, plan);
    const probe = resolveChainBody([{
      id: "zed.paid-cost-gate",
      op: "condition.predicate",
      args: { condition: { kind: "constant", value: playEffect.trigger.condition } }
    }], context, { cost: { plan, receipt } });
    return { context, plan, receipt, probe };
  };

  const paid = runGate(true);
  assert.deepEqual(paid.receipt.additional, [
    { id: additionalCost.effect.id, kind: "additional", paid: true }
  ]);
  assert.equal(paid.probe.results[0].result.linkedValues.value, true);

  const declined = runGate(false);
  assert.deepEqual(declined.plan.declinedAdditional, [additionalCost.effect.id]);
  assert.deepEqual(declined.receipt.additional, []);
  assert.equal(declined.probe.results[0].result.linkedValues.value, false);
});

test("ven-023-166 Zed golden: the exact Shadow Clone token remains blocked by the frozen definition table", () => {
  // Supply a concrete legal Base only to isolate the token-definition check;
  // the card's own destination remains dynamic and is covered by the structure
  // assertions and judge-required TODO below.
  const kernel = world().player("A").build();
  const run = runInstruction(tokenPrimitive, {
    token: playToken.args.token,
    amount: playToken.args.amount,
    mode: playToken.args.mode,
    location: { kind: "constant", value: { type: "base", player: "A" } },
    linkKey: { kind: "constant", value: "shadowClone" }
  }, { world: kernel });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.linked.shadowClone.blockedReason, "token-definition-or-abilities-judge-required");
  assert.deepEqual(kernel.objects.filter((object) => object.isToken), []);
});

test("ven-023-166 Zed golden: the merged cost modifier can plan the optional discard component", () => {
  const buildWorld = () => world()
    .player("A", { energy: 4, power: ["Fury"] })
    .hand("zed", { types: ["unit"], energy: 4, power: ["Fury"] })
    .hand("discard-me", { owner: "A" })
    .build();
  const optionalCost = kernel => ({
    id: additionalCost.effect.id,
    kind: "additional",
    cost: {
      kind: "explicit",
      payments: [{
        kind: "discard",
        choice: {
          id: paymentChoiceId,
          options: [kernel.ref("discard-me")],
          min: 1,
          max: 1,
          selection: "one"
        }
      }]
    }
  });

  const paid = buildWorld();
  const paidRun = runInstruction(costModify, {
    id: "zed-from-the-shadows.plan",
    cost: {
      kind: "explicit",
      energy: { kind: "constant", value: 4 },
      power: { kind: "constant", value: ["Fury"] }
    },
    optionalAdditional: [{ ...optionalCost(paid), selected: true }]
  }, {
    world: paid,
    answers: {
      ["zed-from-the-shadows.plan:pick:" + paymentChoiceId]: [paid.ref("discard-me")]
    }
  });

  assert.equal(paidRun.result.status, "executed");
  assert.deepEqual(paidRun.linked.cost.selectedAdditional, [
    { id: additionalCost.effect.id, kind: "additional" }
  ]);
  assert.deepEqual(paidRun.linked.cost.declinedAdditional, []);
  assert.deepEqual(paidRun.linked.cost.total.actions.map(action => action.action), [
    { type: "discard", object: paid.ref("discard-me") }
  ]);
  assert.equal(paid.query({ zone: "hand" }).length, 2);
  assert.deepEqual(paid.query({ zone: "trash" }), []);

  const declined = buildWorld();
  const declinedRun = runInstruction(costModify, {
    id: "zed-from-the-shadows.plan",
    cost: {
      kind: "explicit",
      energy: { kind: "constant", value: 4 },
      power: { kind: "constant", value: ["Fury"] }
    },
    optionalAdditional: [{ ...optionalCost(declined), selected: false }]
  }, { world: declined });

  assert.equal(declinedRun.result.status, "executed");
  assert.deepEqual(declinedRun.linked.cost.selectedAdditional, []);
  assert.deepEqual(declinedRun.linked.cost.declinedAdditional, [additionalCost.effect.id]);
  assert.deepEqual(declinedRun.linked.cost.total.actions, []);
  assert.equal(declined.query({ zone: "hand" }).length, 2);
});

const paymentChoiceId = "zed.discarded-card";

test.todo(
  "ven-023-166 Zed: the static cost.additional declaration still needs CardProgram → Finalize " +
    "CostPlanInput.optionalAdditional wiring and a controller-hand ObjectRef candidate adapter " +
    "(356.2/356.2.a); condition.result paid/declined receipt evaluation is executable above"
);

test.todo(
  "ven-023-166 Zed: the 0 :rb_might: Shadow Clone token with its own attack ability (CR 187.11) is " +
    "absent from effect.token's frozen definition table (blocked there by design); playing it also " +
    "needs the Finalize location choice for a played token (355.2/355.2.a, 440.2.b.1), whose legal " +
    "destination set still lacks a dynamic candidate producer"
);
