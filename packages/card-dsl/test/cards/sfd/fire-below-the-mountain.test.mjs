// RIFT-654 template execution evidence: ../templates/activated-activated-effect-resources-654.test.mjs
// (printed [Reaction] + Exhaust cost through the real chain, plus the exhausted-source and
// no-invented-Domain [A] boundaries). The card stays judge-required for Universal Power, the
// resource-use restriction, the kind=add bridge and the missing Legend Zone asserted below.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/fire-below-the-mountain.js";

const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { buildCostPlan } = await import(new URL("cost/cost-plan.js", ENGINE));
const { payCostPlan } = await import(new URL("cost/payment.js", ENGINE));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));
const resources = (await import(new URL("effects/instructions/effect.resources.js", ENGINE))).default;
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", ENGINE));
const { translateRestriction } = await import(new URL("programs/play.js", ENGINE));
const { ProgramRegistry } = await import(new URL("programs/registry.js", ENGINE));
const { describeActivate } = await import(new URL("programs/activate.js", ENGINE));

const CANONICAL_ID = "card.hash-4f7b6e74a78c84b04922aadf51f0f8ef02368e59a4158f98eec18e4f301f75fe";
const SOURCE_TEXT =
  ":rb_exhaust:: [Reaction] — [Add] :rb_rune_rainbow:. " +
  "Use only to play gear or use gear abilities. (Abilities that add resources can't be reacted to.)";

const [ability] = program.abilities;
const [addPower] = ability.body;

test("sfd-189-221 Fire Below the Mountain: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("sfd-189-221 Fire Below the Mountain: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Universal/);
  assert.match(program.judgeReason, /163\.2\.b/);
  assert.match(program.judgeReason, /restriction/);
  assert.match(program.judgeReason, /107\.4/);
});

test("sfd-189-221 Fire Below the Mountain: one reaction-speed activated ability with the printed Exhaust cost", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  // 813.1.c.2 / 813.1.d: "[Reaction][>]" on an ability is a Closed-State
  // activation permission, declared as reaction timing.
  assert.equal(ability.timing, "reaction");
  // 404.1.a / 415.5: the printed :rb_exhaust: before the dash is the base cost
  // "Exhaust this", not a body instruction.
  assert.deepEqual(ability.cost, {
    kind: "activated",
    payments: [{ kind: "exhaust", object: "self" }]
  });
  // 204.4.b.1: "Use only to play gear or use gear abilities." restricts the added
  // resource; declared, with no merged consumer (judgeReason item 2).
  assert.deepEqual(ability.restriction, { kind: "use-only-to-play-gear-or-gear-abilities" });

  assert.equal(ability.body.length, 1);
  assert.equal(addPower.id, "fire-below-the-mountain.add-universal-power");
  assert.equal(addPower.op, "effect.resources");
  // 135.2.e.5 / 163.2.b: [A] is Universal Power; the closed six-domain set has no
  // executable value, so the descriptive "rainbow" spelling is kept rather than
  // silently choosing one of the six domains.
  assert.deepEqual(addPower.args, { power: { kind: "constant", value: ["rainbow"] } });
  assert.equal(addPower.args.energy, undefined);
  assert.equal(addPower.targets, undefined);
  assert.equal(addPower.picks, undefined);
  assert.equal(addPower.linkedTo, undefined);
});

test("sfd-189-221 Fire Below the Mountain: the printed Exhaust cost is payable under the merged cost pipeline", () => {
  // 415.4 / 415.5: the exhaust must be able to complete; cost/payment.ts checks it
  // against a ready, controlled object on the Board before charging it.
  const kernel = world()
    .player("A", { energy: 3 })
    .unit("fire-below-the-mountain", { zone: "board", types: ["legend"], controller: "A" })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("fire-below-the-mountain") });
  const plan = buildCostPlan(context, { id: "fire-below-the-mountain", cost: ability.cost });
  const receipt = payCostPlan(context, plan);

  assert.equal(receipt.paid, true);
  assert.equal(receipt.total.energy, 0);
  assert.equal(context.player("A").energy, 3, "the printed cost is Exhaust only, never Energy");
  assert.equal(context.object(context.ref("fire-below-the-mountain")).exhausted, true);
  assert.deepEqual(receipt.actions.map((action) => action.action.type), ["pay", "exhaust"]);
});

test("sfd-189-221 Fire Below the Mountain: the Add instruction only names Power and never Energy", () => {
  // 430.1 / 430.5: "[E]: Add [Y]." adds Power, not Energy. The same primitive with
  // a representable single domain adds exactly one Power of that domain and leaves
  // the Energy pool untouched (contrast ogn/seal-of-unity.ts, whose printed symbol
  // is a single domain); that isolates the instruction's shape from the [A]
  // representation gap recorded in judgeReason and the todo below.
  const kernel = world().player("A", { energy: 2 }).build();
  const run = runInstruction(resources, { power: { kind: "constant", value: ["Order"] } }, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.player("A").power, ["Order"]);
  assert.equal(kernel.player("A").energy, 2, "an Add of Power never changes Energy");
  assert.deepEqual(run.events.map((event) => event.action), ["gain-power"]);
});

// The previous "Universal Add fails closed", "restriction needs a rules
// adapter" and "activation adapter cannot build an Add draft" goldens assert
// the missing-adapter gaps that judgeReason also records; they are restored
// under the tightened review rule and stay aligned with the TODO entries below.
test("sfd-189-221 Fire Below the Mountain: the original Universal Add body fails closed without changing resources", () => {
  const kernel = world().player("A", { energy: 2, power: ["Order"] }).build();
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "negated", reason: "impossible", events: [] });
  assert.deepEqual(kernel.player("A").power, ["Order"]);
  assert.equal(kernel.player("A").energy, 2);
  assert.deepEqual(kernel.events, []);
});

test("sfd-189-221 Fire Below the Mountain: the printed resource-use restriction requires a rules adapter", () => {
  // programs/play.ts translateRestriction rejects this descriptive resource-use
  // kind; the judge-required error is the missing-adapter gap, named in
  // judgeReason, not an approved game rule.
  assert.throws(() => translateRestriction(ability.restriction, CANONICAL_ID), error => {
    assert.equal(error.code, "judge-required");
    assert.match(error.message, /use-only-to-play-gear-or-gear-abilities/);
    return true;
  });
});

test("sfd-189-221 Fire Below the Mountain: the production activation adapter cannot build an Add draft", () => {
  // 430.2 / 430.3: a Reaction Add ability finalizes immediately and may be
  // activated while costs are paid. chain/engine.ts only admits kind "add"
  // (and only at reaction speed) for that path, while programs/activate.ts
  // always emits kind "activated" — after the printed restriction already
  // fails closed. Both halves are asserted instead of treating the Board
  // exhaust fixture as activation support.
  const { judgeReason, ...binding } = program;
  const registry = new ProgramRegistry([{ ...binding, status: "executable" }]);
  const kernel = world()
    .unit("fire-below-the-mountain", { cardId: CANONICAL_ID, types: ["legend"], energy: null, power: null, might: null })
    .build();
  assert.throws(
    () => describeActivate(registry, kernel.getObject("fire-below-the-mountain"), "A", 0),
    error => {
      assert.equal(error.code, "judge-required");
      assert.match(error.message, /use-only-to-play-gear-or-gear-abilities/);
      return true;
    }
  );
  // Even with the restriction satisfied, the adapter emits an activated draft;
  // there is no merged producer that turns this program into kind "add".
  assert.equal(callActivateWithNoRestriction(binding), "activated");
});

/** Mirrors programs/activate.ts's draft kind for this ability without its restriction. */
function callActivateWithNoRestriction(binding) {
  const { restriction: _restriction, ...unrestricted } = binding.abilities[0];
  const registry = new ProgramRegistry([{ ...binding, abilities: [unrestricted], status: "executable" }]);
  const kernel = world()
    .unit("fire-below-the-mountain", { cardId: CANONICAL_ID, types: ["legend"], energy: null, power: null, might: null })
    .build();
  return describeActivate(registry, kernel.getObject("fire-below-the-mountain"), "A", 0).kind;
}

test.todo(
  "sfd-189-221 Fire Below the Mountain: represent and spend Universal Power ([A], CR 135.2.e.5 / " +
    "163.2.b) — the closed Domain union and the gain-power action have no universal value " +
    "(contract change request)"
);

test.todo(
  "sfd-189-221 Fire Below the Mountain: enforce “Use only to play gear or use gear abilities.” " +
    "(204.4.b.1 restriction family) — bind added-resource provenance and spending purposes; " +
    "translateRestriction still rejects this custom restriction kind"
);

test.todo(
  "sfd-189-221 Fire Below the Mountain: programs/activate.ts must classify this ability as Add " +
    "so ChainDraft.kind=add can enter immediate resolution and Reaction Add during payment (430.2/430.3)"
);

test.todo(
  "sfd-189-221 Fire Below the Mountain: the Champion Legend's own zone is the Legend Zone " +
    "(CR 107.4.c); the frozen ZoneId union has no legend-zone, so “exhaust me” cannot cite the " +
    "legend's real zone in production (shared contract gap, not specific to this card)"
);
