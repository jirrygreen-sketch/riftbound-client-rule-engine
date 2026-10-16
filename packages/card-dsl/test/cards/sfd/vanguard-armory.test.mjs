import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/vanguard-armory.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { buildCostPlan } = await import(new URL("cost/index.js", ENGINE));
const { payCostPlan } = await import(new URL("cost/payment.js", ENGINE));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));
const token = (await import(new URL("effects/instructions/effect.token.js", ENGINE))).default;

const CANONICAL = "card.hash-1a195f8245b52279e6972886278ad1ad1a5802773ad4affa1e6ecff419aad1aa";
const SOURCE_TEXT =
  ":rb_exhaust:: Play three 1 :rb_might: Recruit unit tokens. (You may play them to different locations.)";

const [ability] = program.abilities;
const [playRecruits] = ability.body;

/** Vanguard Armory on the Board, ready. */
function armoryWorld({ exhausted = false } = {}) {
  const base = world()
    .object("vanguard-armory", {
      name: "Vanguard Armory",
      cardId: CANONICAL,
      types: ["gear"],
      tags: [],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 7,
      power: ["Order"],
      might: null,
      exhausted
    })
    .build();
  return base.clone({ sourceSnapshot: base.getObject("vanguard-armory") });
}

test("sfd-168-221 Vanguard Armory: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("sfd-168-221 Vanguard Armory: identity, ruleset, status, judgeReason and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // README section 2: the reason names the missing destination reading and the
  // rule it depends on, plus the chain wiring.
  assert.match(program.judgeReason, /355\.2/);
  assert.match(program.judgeReason, /LocationRef/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-168-221 Vanguard Armory: one action-speed activated ability costing Exhaust this", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  // 151.2: Gear activations default to Action timing (no printed [Reaction]).
  assert.equal(ability.timing, "action");
  // 204.1.b / 415.3.a / 415.5: the printed ":rb_exhaust:" before the colon is the
  // activation cost "Exhaust this".
  assert.deepEqual(ability.cost, {
    kind: "activated",
    payments: [{ kind: "exhaust", object: "self" }]
  });
  assert.equal(ability.restriction, undefined);
});

test("sfd-168-221 Vanguard Armory: three Recruit tokens played through the chain, no fixed location", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(playRecruits.id, "vanguard-armory.play-recruits");
  assert.equal(playRecruits.op, "effect.token");
  // CR 187.1: the frozen Recruit definition (1 Might unit token, no printed cost).
  assert.deepEqual(playRecruits.args.token, { kind: "constant", value: "recruit" });
  assert.deepEqual(playRecruits.args.amount, { kind: "constant", value: 3 });
  // 440.2.c / 185.2.a: a NEW token is created on the Chain and handed to play.
  assert.deepEqual(playRecruits.args.mode, { kind: "constant", value: "play" });
  // 355.2/355.2.a: each token's location is chosen when it is played; the merged
  // effect.token cannot express a per-token choice, so no location is pinned
  // here (writing one Base or one Battlefield would delete the printed option).
  assert.equal(playRecruits.args.location, undefined);
  assert.equal(playRecruits.args.locations, undefined);
  assert.equal(playRecruits.args.choiceId, undefined);
  assert.equal(playRecruits.targets, undefined);
  assert.equal(playRecruits.picks, undefined);
  assert.equal(playRecruits.linkedTo, undefined);
});

test("sfd-168-221 Vanguard Armory golden: the printed Exhaust cost really pays through the merged cost pipeline", () => {
  const context = armoryWorld();
  const plan = buildCostPlan(context, { id: "vanguard-armory", cost: ability.cost });
  const receipt = payCostPlan(context, plan);

  assert.equal(receipt.paid, true);
  assert.equal(receipt.total.energy, 0);
  assert.deepEqual(receipt.total.power, []);
  assert.deepEqual(receipt.actions.map((action) => action.action.type), ["pay", "exhaust"]);
  assert.equal(context.getObject("vanguard-armory").exhausted, true);
});

test("sfd-168-221 Vanguard Armory golden: an already exhausted Gear cannot pay the printed cost (CR 415.4)", () => {
  const context = armoryWorld({ exhausted: true });
  assert.throws(
    () => payCostPlan(context, buildCostPlan(context, { id: "vanguard-armory", cost: ability.cost })),
    (error) => error?.reason === "cannot-pay-cost"
  );
  assert.equal(context.getObject("vanguard-armory").exhausted, true);
});

test("sfd-168-221 Vanguard Armory golden: the printed token body plays three 1-Might Recruits", () => {
  // The golden supplies the concrete location that the printed per-token choice
  // (355.2/355.2.a) would yield; the program's token/amount/mode come from the
  // card data unchanged.
  const kernel = world().build();
  const base = { type: "base", player: "A" };
  const run = runInstruction(
    token,
    {
      token: playRecruits.args.token,
      amount: playRecruits.args.amount,
      mode: playRecruits.args.mode,
      location: { kind: "constant", value: base }
    },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.token.amount, 3);
  assert.equal(run.linked.token.createdAmount, 3);
  assert.equal(run.linked.token.objectsComplete, true);
  // 440.2.c / 185.2.a: each token is created on the Chain and then played.
  assert.deepEqual(run.events.map((event) => event.action), [
    "create-token", "play", "create-token", "play", "create-token", "play"
  ]);
  assert.deepEqual(kernel.pendingItems, []);

  const recruits = kernel.query({ zone: "board", type: "unit" }).filter((object) => object.isToken);
  assert.equal(recruits.length, 3);
  for (const recruit of recruits) {
    // CR 187.1: Recruit is a 1-Might unit token; 185.3 keeps its cost absent.
    assert.equal(recruit.name, "Recruit");
    assert.equal(recruit.might, 1);
    assert.deepEqual(recruit.tags, ["Recruit"]);
    assert.deepEqual(recruit.types, ["unit"]);
    assert.equal(recruit.energy, null);
    assert.equal(recruit.power, null);
    assert.deepEqual(recruit.location, base);
    assert.equal(recruit.controller, "A");
  }
});

test.todo(
  "sfd-168-221 Vanguard Armory: letting the controller choose each token's location (CR 355.2/" +
    "355.2.a: its Base or a Battlefield it controls) needs a merged reader that turns the legal " +
    "location set into concrete LocationRefs plus the finalize-time play-location choice " +
    "(RIFT-9 target.location); effect.token only accepts one fixed location or one choice for the " +
    "whole instruction."
);
test.todo(
  "sfd-168-221 Vanguard Armory: the card-program -> chain activation wiring (contract 3.5) is not " +
    "merged - RIFT-120 follow-up; the printed cost and token body above run directly."
);
