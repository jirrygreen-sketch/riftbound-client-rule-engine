import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/bloodharbor-ripper.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-44826d4fb44c1cba31372acf1fccde3b5f508addd708d0b4314a96a94579b8c3";
const SOURCE_TEXT =
  ":rb_energy_1:, :rb_exhaust:: Return a friendly unit at a battlefield to its owner's hand. " +
  'Play a Gold gear token exhausted. (It has "[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.")';

const [ability] = program.abilities;
const [returnUnit, playGold] = ability.body;
const targetSpec = returnUnit.targets[0];

test("unl-185-219 Bloodharbor Ripper: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-185-219 Bloodharbor Ripper: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Gold gear token/);
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /143\.4/);
  assert.match(program.judgeReason, /RIFT-62/);
});

test("unl-185-219 Bloodharbor Ripper: 1 Energy + Exhaust activation at Action speed", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  // 404.1.a / 415.5: the printed ":rb_energy_1:, :rb_exhaust:" is the cost;
  // no [Reaction] is printed, so the ability uses the default Action timing.
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.cost, {
    kind: "activated",
    energy: { kind: "constant", value: 1 },
    payments: [{ kind: "exhaust", object: "self" }]
  });
  assert.equal(ability.restriction, undefined);
});

test("unl-185-219 Bloodharbor Ripper: return-to-hand targets one friendly unit at a battlefield", () => {
  assert.equal(returnUnit.id, "bloodharbor-ripper.return-unit");
  assert.equal(returnUnit.op, "effect.zone");
  assert.deepEqual(returnUnit.args.to, { kind: "constant", value: "hand" });
  // 355.9 / 355.10: "a friendly unit at a battlefield" is a single target.
  assert.deepEqual(targetSpec, {
    id: "friendly-unit-at-battlefield",
    filter: {
      type: "unit",
      controller: "controller",
      location: { type: "battlefield" }
    },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(returnUnit.picks, undefined);
  assert.equal(returnUnit.linkedTo, undefined);
});

test("unl-185-219 Bloodharbor Ripper: the Gold token half is a separate statement, not a link", () => {
  // "Play a Gold gear token exhausted." is its own sentence: the return-to-hand
  // instruction is not an "do X to Y" gate, so there is no linkedTo.
  assert.equal(playGold.id, "bloodharbor-ripper.play-gold");
  assert.equal(playGold.op, "effect.token");
  assert.deepEqual(playGold.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(playGold.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playGold.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(playGold.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  // The "exhausted" entry override (143.4 / 184.1) has no IR argument; it is
  // recorded in judgeReason and must not be faked by create-then-exhaust.
  assert.deepEqual(Object.keys(playGold.args).sort(), ["amount", "location", "mode", "token"]);
  assert.equal(playGold.linkedTo, undefined);
});

test("unl-185-219 Bloodharbor Ripper: the printed cost is payable through the merged cost pipeline", () => {
  const kernel = world()
    .player("A", { energy: 2 })
    .unit("pyke", { zone: "board", types: ["legend"], controller: "A", exhausted: false })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("pyke")) });
  const plan = buildCostPlan(ctx, { id: "bloodharbor-ripper", cost: ability.cost });
  const receipt = payCostPlan(ctx, plan);
  assert.equal(receipt.paid, true);
  assert.equal(receipt.total.energy, 1);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "exhaust"]);
  assert.equal(ctx.player("A").energy, 1);
  assert.equal(ctx.object(ctx.ref("pyke")).exhausted, true);
});

test("unl-185-219 Bloodharbor Ripper: the return half executes the program's own args on the reference kernel", () => {
  // Index 0 of the body is a single effect.zone instruction, so it runs through
  // the primitive runner with the program's own printed arguments and the
  // Finalize-locked target set (README §4: run existing primitives for the
  // supported half; the program body itself is driven where the interpreter's
  // evaluated-argument protocol matches the primitive schema).
  const kernel = world()
    .unit("pyke", { zone: "board", types: ["legend"], controller: "A" })
    .unit("ally", { zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const run = runInstruction(
    zone,
    { target: targetSpec.id, to: returnUnit.args.to },
    { world: kernel, targets: { [targetSpec.id]: [kernel.ref("ally")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked, { moved: 1, movedIds: ["ally"], destination: "hand" });
  // 108 / 128: the unit leaves the board and its owner draws it back into hand.
  assert.equal(kernel.getObject("ally").zone, "hand");
  assert.equal(kernel.getObject("ally").owner, "A");
  assert.deepEqual(kernel.events.map(event => event.action), ["return-to-hand"]);
});

test("unl-185-219 Bloodharbor Ripper: a stale locked target makes the return ignored (CR 359.3.e.5–e.7)", () => {
  const kernel = world()
    .unit("ally", { zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const stale = kernel.ref("ally");
  kernel.perform({ type: "kill", object: stale });
  const run = runInstruction(
    zone,
    { target: targetSpec.id, to: returnUnit.args.to },
    { world: kernel, targets: { [targetSpec.id]: [stale] } }
  );
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
});

test("unl-185-219 Bloodharbor Ripper: playing the Gold token is blocked, not approximated", () => {
  // effect.token has no Gold definition (CR 187.5 carries its own ability) and
  // mode "play" needs chain creation; the primitive must negate instead of
  // creating a board token as a stand-in.
  const kernel = world().build();
  const run = runInstruction(
    token,
    {
      token: playGold.args.token,
      mode: playGold.args.mode,
      amount: playGold.args.amount,
      location: { kind: "constant", value: { type: "base", player: "A" } }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.linked.token.amount, 0);
  assert.equal(run.linked.token.blockedReason, "token-definition-or-abilities-judge-required");
  assert.deepEqual(
    kernel.query({ zone: "board", type: "gear" }),
    [],
    "no substitute gear token may be created"
  );
  assert.deepEqual(kernel.events, []);
});

test.todo(
  "unl-185-219 Bloodharbor Ripper: Gold gear token definition with its printed ability (CR 187.5) — effect.token's frozen table has no gold entry"
);
test.todo(
  "unl-185-219 Bloodharbor Ripper: chain-create then cost-waived play of the token (CR 440.2.c / 185.2.a / 350.2 / 354) — RIFT-62"
);
test.todo(
  "unl-185-219 Bloodharbor Ripper: exhausted entry override on the created token (CR 143.4 / 184.1 / 185.2.d)"
);
