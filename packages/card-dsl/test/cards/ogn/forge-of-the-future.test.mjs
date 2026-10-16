import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/forge-of-the-future.js";
import tokenDefinition from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import recycleDefinition from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";

const [playTrigger, activated] = program.abilities;

const withSource = (builder, id) => {
  const kernel = builder.build();
  return kernel.clone({ sourceSnapshot: kernel.object(kernel.ref(id)) });
};

/** A cost.pay stand-in that drives the real merged cost plan + payment pipeline. */
const costProbe = {
  op: "cost.probe",
  argsSchema: { parse: value => value },
  execute(context, args) {
    const receipt = payCostPlan(context, buildCostPlan(context, args));
    return { status: "executed", events: [...receipt.events], linkedValues: { paid: receipt.paid } };
  }
};

test("forge-of-the-future: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
});

test("forge-of-the-future: identity, ruleset, status, judgeReason and printed text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-6f281c2d37b0aff601bde72fa6b91be879ad2c992845d19dca912d60e4808343"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The gaps are the plural "trashes" zone scope (108.2.a) and the "up to"
  // choice size; the kill cost itself is expressible.
  assert.match(program.judgeReason, /trashes/);
  assert.match(program.judgeReason, /effect\.recycle/);
  assert.match(program.judgeReason, /355\.13/);
  assert.equal(
    program.sourceText,
    "When you play this, play a 1 :rb_might: Recruit unit token at your base.\n" +
      "Kill this: Recycle up to 4 cards from trashes."
  );
});

test("forge-of-the-future: \"when you play this\" is a card-played self trigger, mandatory", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, { event: "card-played", source: "self", player: "controller" });
  assert.equal(playTrigger.optional, false);
  assert.equal(playTrigger.trigger.once, undefined);
});

test("forge-of-the-future: the Recruit token is played via the chain-creation form into the controller's base", () => {
  assert.equal(playTrigger.body.length, 1);
  const [instruction] = playTrigger.body;
  assert.equal(instruction.id, "forge-of-the-future.play-recruit");
  assert.equal(instruction.op, "effect.token");
  // CR v1.5 187.1 Recruit: 1 Might unit token with no printed abilities.
  assert.deepEqual(instruction.args.token, { kind: "constant", value: "recruit" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  // CR v1.5 440.2.c / 185.2.a: a played token is created on the Chain first.
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(instruction.args.locations, {
    kind: "constant",
    value: [{ type: "base", player: "controller" }]
  });
  assert.deepEqual(instruction.args.choiceId, { kind: "constant", value: "forge-of-the-future.recruit-base" });
  assert.deepEqual(instruction.args.linkKey, { kind: "constant", value: "recruitToken" });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("forge-of-the-future: the second ability is action-timed with \"kill this\" as a cost payment", () => {
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  // "Kill this:" is the cost half of the colon-separated activated ability
  // (377.1 / 429.6), declared as a nonstandard cost payment rather than an
  // effect instruction.
  assert.deepEqual(activated.cost, { kind: "activated", payments: [{ kind: "kill" }] });
  assert.equal(activated.body.length, 1);
  const [recycle] = activated.body;
  assert.equal(recycle.id, "forge-of-the-future.recycle-up-to-4");
  assert.equal(recycle.op, "effect.recycle");
  assert.deepEqual(recycle.args.from, {
    kind: "constant",
    value: { zone: "trash", amount: { kind: "constant", value: 4 } }
  });
  // 417.6: "Recycle X from [Zone]" is a non-targeting choice.
  assert.equal(recycle.targets, undefined);
  assert.equal(recycle.picks, undefined);
});

test("forge-of-the-future golden: the Recruit token is created on the Chain and played at the base", () => {
  const kernel = world()
    .base("forge-of-the-future", { types: ["gear"], name: "Forge of the Future" })
    .build();
  const [instruction] = playTrigger.body;
  // The reference kernel evaluates Expr args itself; substitute the printed
  // controller-base placeholder with the concrete player base, exactly as the
  // caller does for the merged effect.token primitive.
  const args = {
    ...instruction.args,
    locations: { kind: "constant", value: [{ type: "base", player: "A" }] }
  };
  const run = runInstruction(tokenDefinition, args, { world: kernel });

  assert.equal(run.result.status, "executed");
  const tokens = kernel.query({ zone: "board", type: "unit" }).filter((object) => object.isToken);
  assert.equal(tokens.length, 1);
  const [token] = tokens;
  // CR 187.1: Recruit is a 1 Might unit token with no printed cost or power.
  assert.equal(token.name, "Recruit");
  assert.equal(token.might, 1);
  assert.deepEqual(token.tags, ["Recruit"]);
  assert.equal(token.energy, null);
  assert.equal(token.power, null);
  assert.deepEqual(token.location, { type: "base", player: "A" });
  assert.equal(token.controller, "A");
  // The chain-created identity is consumed by the play and is not left pending.
  assert.equal(kernel.pendingItems.length, 0);
  // Both the Chain-creation receipt and the played-object link are recorded.
  assert.equal(run.result.linkedValues["recruitToken.amount"], 1);
  assert.equal(run.result.linkedValues["recruitToken.createdAmount"], 1);
  assert.equal(run.result.linkedValues["recruitToken.objects"].length, 1);
  assert.deepEqual(run.result.linkedValues["recruitToken.objects"][0], token.ref);
});

test("forge-of-the-future golden: the printed card-played event is what the trigger subscribes to", () => {
  const kernel = world().base("forge-of-the-future", { types: ["gear"] }).build();
  const [instruction] = playTrigger.body;
  const run = runInstruction(
    tokenDefinition,
    { ...instruction.args, locations: { kind: "constant", value: [{ type: "base", player: "A" }] } },
    { world: kernel }
  );
  assert.deepEqual(run.events.map((event) => event.action), ["create-token", "play"]);
  assert.equal(run.events[1].timingPoint, "card-played");
});

test("forge-of-the-future golden: \"Kill this\" is paid as a real kill CostAction", () => {
  const context = withSource(world().base("forge-of-the-future", { types: ["gear"] }), "forge-of-the-future");
  const run = runInstruction(
    costProbe,
    { id: "forge-of-the-future:cost", cost: activated.cost },
    { world: context }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.result.linkedValues.paid, true);
  // CR 429.1 / 429.2.a: the kill moves the Gear from the Board to its Trash.
  assert.equal(context.getObject("forge-of-the-future").zone, "trash");
  // The cost plan submits its resource `pay` plan first, then the nonstandard
  // kill payment (cost/payment.ts order).
  assert.deepEqual(run.events.map((event) => event.action), ["pay", "kill"]);
});

test("forge-of-the-future golden: the supported controller-Trash recycle path executes four cards", () => {
  const kernel = world()
    .base("forge-of-the-future", { types: ["gear"] })
    .card("t1", { types: ["unit"], zone: "trash" })
    .card("t2", { types: ["unit"], zone: "trash" })
    .card("t3", { types: ["unit"], zone: "trash" })
    .card("t4", { types: ["unit"], zone: "trash" })
    .card("t5", { types: ["unit"], zone: "trash" })
    .card("t6", { types: ["unit"], zone: "trash" })
    .build();
  const [recycle] = activated.body;
  const run = runInstruction(
    recycleDefinition,
    { from: recycle.args.from.value },
    {
      world: kernel,
      answers: { "effect.recycle:trash:controller:4": [kernel.ref("t1"), kernel.ref("t2"), kernel.ref("t3"), kernel.ref("t4")] }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.recycledCount, 4);
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["t5", "t6"]);
  assert.deepEqual(kernel.zone("A", "deck").slice(-4).map(ref => ref.id), ["t1", "t2", "t3", "t4"]);
});
