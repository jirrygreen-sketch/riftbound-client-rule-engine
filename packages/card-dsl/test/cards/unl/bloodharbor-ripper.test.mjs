import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/bloodharbor-ripper.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { getTokenDefinition } from "../../../../engine-core/dist/effects/tokens/definitions.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
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

/**
 * chain/engine.ts resolves the static controller/owner spellings before it
 * calls the production matcher ('controller' becomes the ability controller,
 * and location "battlefield" is compared against the Location type in
 * layers/filter.ts). The reference kernel compares filter values literally, so
 * the goldens go through the same normalization the production chain applies
 * (the merged sfd/switcheroo and ogn/siphon-power goldens use this helper).
 */
const chainContext = (kernel, controller) => bindResolveContext(kernel, {
  controller,
  query: (filter) => kernel.objects.filter((object) => matchesObjectFilter(
    Object.fromEntries(Object.entries(filter).map(([key, value]) =>
      [key, (key === "controller" || key === "owner") && value === "controller" ? controller : value])),
    object
  ))
});

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
  // The merged create-token-to-chain / effect.play handoff is no longer a gap:
  // it is asserted below with a real token definition and executed by the
  // golden test, so the reason only records the Gold definition and the entry
  // state override that are still missing.
  assert.doesNotMatch(program.judgeReason, /RIFT-62/);
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
    // The merged filter vocabulary spells "at a battlefield" as
    // location: "battlefield"; programs/filters.ts refuses a structured
    // { type: "battlefield" } without a concrete identity, which would make the
    // production describeActivate throw instead of locking a target.
    filter: { type: "unit", controller: "controller", location: "battlefield" },
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

test("unl-185-219 Bloodharbor Ripper: the return half runs the program's own body through the chain adapter", () => {
  // effect.zone declares Expr-typed arguments, so the card's own body is driven
  // through the production chain adapter (the same path ogn/amateur-recital
  // uses) with the Finalize-locked target set.
  const kernel = world()
    .unit("pyke", { zone: "board", types: ["legend"], controller: "A" })
    .unit("ally", { zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.setTargets(targetSpec.id, [kernel.ref("ally")]);
  const scoped = chainContext(
    kernel.clone({ sourceSnapshot: kernel.getObject("pyke"), controller: "A" }),
    "A"
  );

  const outcome = resolveChainBody([returnUnit], scoped);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["bloodharbor-ripper.return-unit", "executed"]
  ]);
  // effect.zone's receipt is written under the instruction's path-qualified key.
  assert.equal(scoped.linkedSnapshot()["bloodharbor-ripper.return-unit.moved"], 1);
  // 108 / 128: the unit leaves the board and its owner draws it back into hand.
  assert.equal(scoped.getObject("ally").zone, "hand");
  assert.equal(scoped.getObject("ally").owner, "A");
  assert.deepEqual(outcome.events.map(event => event.action), ["return-to-hand"]);
});

test("unl-185-219 Bloodharbor Ripper: mode \"play\" really creates on the Chain and hands the token to play", () => {
  // 440.2.c / 185.2.a / 350.2 / 354: the merged effect.token creates the token
  // on the Chain and then performs the play for that ref. The Gold definition
  // itself is still missing (CR 187.5), so the merged handoff is exercised with
  // a token the frozen table does define — never substituted into the card.
  const kernel = world().player("A", { energy: 0 }).build();
  const scoped = kernel.clone({ controller: "A" });
  const outcome = resolveChainBody(
    [
      {
        id: "probe.play-defined-token",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "mech" },
          mode: { kind: "constant", value: "play" },
          location: { kind: "constant", value: { type: "base", player: "A" } }
        }
      }
    ],
    scoped
  );
  assert.equal(outcome.status, "executed");
  const receipt = outcome.results[0].result.linkedValues.token;
  assert.equal(receipt.createdAmount, 1);
  assert.equal(receipt.amount, 1);
  assert.deepEqual(outcome.events.map(event => [event.action, event.timingPoint]), [
    ["create-token", "chain-item-pending"],
    ["play", "card-played"]
  ]);
  assert.equal(scoped.objects.find(object => object.isToken).zone, "board");
});

test("unl-185-219 Bloodharbor Ripper: a stale locked target makes the return ignored (CR 359.3.e.5–e.7)", () => {
  const kernel = world()
    .unit("ally", { zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const stale = kernel.ref("ally");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets(targetSpec.id, [stale]);
  const scoped = chainContext(
    kernel.clone({ sourceSnapshot: kernel.getObject("pyke"), controller: "A" }),
    "A"
  );

  const outcome = resolveChainBody([returnUnit], scoped);
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(outcome.events, []);
});

test("unl-185-219 Bloodharbor Ripper: playing the Gold token creates the canonical carrier", () => {
  // The printed `play` path now uses the CR 187.5 canonical Gold definition.
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
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.token.amount, 1);
  assert.equal(run.linked.token.createdAmount, 1);
  assert.equal(run.linked.token.blockedReason, undefined);
  const golds = run.world.query({ zone: "board", type: "gear" }).filter(object => object.isToken);
  assert.equal(golds.length, 1);
  assert.equal(golds[0].name, "Gold");
  assert.deepEqual(golds[0].types, ["gear"]);
  assert.deepEqual(golds[0].location, { type: "base", player: "A" });
  assert.deepEqual(run.events.map(event => [event.action, event.timingPoint]), [
    ["create-token", "chain-item-pending"],
    ["pay", "main-start"],
    ["play", "card-played"]
  ]);
});

test("unl-185-219 Bloodharbor Ripper: the Gold definition is present with its canonical card id (187.5)", () => {
  // 187.5's Gold is present in the token table and points to the canonical
  // ability-bearing card program rather than an ability-free substitute.
  const kernel = world().player("A", { energy: 0 }).build();
  const definition = getTokenDefinition("gold");
  assert.ok(definition);
  assert.equal(definition.spec.cardId, "card.hash-6249df4367d0a2e088c8eb1117ef59430f0d7dad4bf0fcf8a01d7f0415f4d511");
  assert.equal(definition.abilityBinding, "canonical-card-program");
  assert.equal(definition.defaultEntry, "ready");
  const run = runInstruction(
    token,
    {
      token: { kind: "constant", value: "gold" },
      mode: { kind: "constant", value: "play" },
      amount: { kind: "constant", value: 1 },
      location: { kind: "constant", value: { type: "base", player: "A" } }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.token.blockedReason, undefined);
  assert.equal(run.linked.token.createdAmount, 1);
  assert.equal(run.world.query({ zone: "board", type: "gear" }).filter(object => object.isToken).length, 1);
});

test("unl-185-219 Bloodharbor Ripper: effect.token has no exhausted entry override argument (143.4 / 184.1)", () => {
  // 185.2.d / 143.4 put the entry orientation on the creation action itself.
  // The primitive's frozen argument list is exactly
  // token/amount/mode/location/target/pick/locations/choiceId/linkKey, so there
  // is no entry-state argument and create-then-exhaust cannot substitute.
  assert.throws(
    () => token.argsSchema.parse({
      token: { kind: "constant", value: "gold" },
      exhausted: { kind: "constant", value: true }
    }),
    /Invalid effect\.token argument: exhausted/
  );
});

test.todo(
  "unl-185-219 Bloodharbor Ripper: Gold gear token definition with its printed ability (CR 187.5) — effect.token's frozen table has no gold entry"
);
test.todo(
  "unl-185-219 Bloodharbor Ripper: exhausted entry override on the created token (CR 143.4 / 184.1 / 185.2.d)"
);
