import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/marching-orders.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// Production resolves a card body through the chain's interpreter adapter, the
// same entry point the merged chain uses for card programs.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import might from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesTriggerObject } from "../../../../engine-core/dist/events/pipeline-match.js";
import { translateCost } from "../../../../engine-core/dist/programs/play.js";
import { LayerEngine } from "../../../../engine-core/dist/layers/engine.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { describePlay } from "../../../../engine-core/dist/programs/play.js";
import { abilitySpeed } from "../../../../engine-core/dist/programs/keywords.js";

const CANONICAL = "card.hash-7665f836ecbe39043d8dd42f110ad82560fe857373dbf87d7348d347e764617c";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "[Repeat] :rb_energy_3: (You may pay the additional cost to repeat this spell's effect.)\n" +
  "Choose a friendly unit anywhere and an enemy unit at a battlefield. " +
  "They deal damage equal to their Mights to each other.";

const [speed, play] = program.abilities;
const [friendlyDeals, enemyDeals] = play.body;

// Bind symbolic controller filters with the engine's real matcher. Keep the
// original TargetSpecs so the interpreter rechecks battlefield restrictions.
function context(kernel) {
  const layers = new LayerEngine(kernel.objects);
  for (const entry of kernel.continuousEffects) layers.addContinuous(entry.effect, entry.duration);
  return bindResolveContext(kernel, {
    object: ref => { layers.setObjects(kernel.objects); return layers.evaluate(ref); },
    query: filter => {
      layers.setObjects(kernel.objects);
      return layers.evaluateAll().filter(object => matchesTriggerObject(filter, object, kernel.controller));
    }
  });
}

test("sfd-114-221 Marching Orders: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-114-221 Marching Orders: judgeReason names the [Repeat] cost gap and its tasks", () => {
  assert.match(program.judgeReason, /\[Repeat\]/);
  assert.match(program.judgeReason, /820\.1\.c/);
  assert.match(program.judgeReason, /programs\/play\.ts/);
  // The damage half is executable and must be reported as such, not as a gap.
  assert.match(program.judgeReason, /golden 已用生产链适配器真实执行/);
  assert.match(program.judgeReason, /Unsupported play cost field keyword/);
});

test("sfd-114-221 Marching Orders: [Action] keyword plus the [Repeat] additional cost", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  // 820.1.c: the printed "Repeat :rb_energy_3:" cost travels on the play
  // CostSpec (356.2.b.1), the merged sfd/danger-zone shape; the Repeat
  // The KeywordDef is merged, but the card-program cost plan that would collect it
  // is not wired through Finalize (programs/play.ts rejects additional-cost).
  assert.deepEqual(play.cost, {
    kind: "additional-cost",
    keyword: "repeat",
    energy: { kind: "literal", value: 3 }
  });
});

test("sfd-114-221 Marching Orders: two targeted, unlinked Deals that read each unit's Might", () => {
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["marching-orders.friendly-deals", "effect.damage"],
      ["marching-orders.enemy-deals", "effect.damage"]
    ]
  );

  // "an enemy unit at a battlefield": the unit is the target (355.9.a.1) and
  // "at a battlefield" is only a targeting restriction (355.10.b).
  assert.deepEqual(friendlyDeals.targets, [
    {
      id: "marching-orders.enemy-unit",
      filter: {
        type: "unit",
        zone: "board",
        controller: "opponent"
      },
      location: { type: "battlefield" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  // "a friendly unit anywhere": only the controller is restricted.
  assert.deepEqual(enemyDeals.targets, [
    {
      id: "marching-orders.friendly-unit",
      filter: { type: "unit", zone: "board", controller: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  // 418.6.b.3: each chosen unit is the source of its own Deal; the amount is
  // that unit's Might, read at resolution (contract 3.6). Neither instruction
  // is linked to the other (359.3.e.7/.12: no last-known substitution).
  for (const [instruction, self, other] of [
    [friendlyDeals, "marching-orders.friendly-unit", "marching-orders.enemy-unit"],
    [enemyDeals, "marching-orders.enemy-unit", "marching-orders.friendly-unit"]
  ]) {
    assert.deepEqual(instruction.args.amount, {
      kind: "object-property",
      object: { target: self },
      property: "might"
    });
    assert.deepEqual(instruction.args.source, {
      kind: "object-property",
      object: { target: self },
      property: "ref"
    });
    assert.deepEqual(instruction.args.target, { kind: "constant", value: other });
    assert.equal(instruction.args.combat, undefined);
    assert.equal(instruction.args.divide, undefined);
    assert.equal(instruction.linkedTo, undefined);
  }
});

test("sfd-114-221 Marching Orders golden: the chosen units damage each other by their Mights", () => {
  const kernel = world()
    .unit("ally", { owner: "A", might: 3 })
    .unit("enemy", { owner: "B", might: 5 })
    .build();
  kernel.setTargets("marching-orders.friendly-unit", [kernel.ref("ally")]);
  kernel.setTargets("marching-orders.enemy-unit", [kernel.ref("enemy")]);
  // 418.6.b.3 makes each chosen unit the source of its own damage; the
  // committed GameActions prove source references as well as marked damage.
  const outcome = resolveChainBody(play.body, context(kernel));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => entry.result.status), [
    "executed",
    "executed"
  ]);
  assert.equal(kernel.getObject("ally").damage, 5);
  assert.equal(kernel.getObject("enemy").damage, 3);
  assert.deepEqual(kernel.snapshot().history.map(entry => entry.action), [
    {
      type: "damage",
      source: kernel.ref("ally"),
      target: kernel.ref("enemy"),
      amount: 3,
      combat: false
    },
    {
      type: "damage",
      source: kernel.ref("enemy"),
      target: kernel.ref("ally"),
      amount: 5,
      combat: false
    }
  ]);
  assert.deepEqual(outcome.events.map((event) => event.action), ["damage", "damage"]);
});

test("sfd-114-221 Marching Orders golden: the two current Mights are read independently", () => {
  // Contract 3.6: value expressions are evaluated when used, so a Might change
  // between finalization and resolution is respected (418.6.b.3's unit source
  // is the same unit that was chosen).
  const kernel = world()
    .unit("ally", { owner: "A", might: 1 })
    .unit("enemy", { owner: "B", might: 4 })
    .build();
  kernel.setTargets("marching-orders.friendly-unit", [kernel.ref("ally")]);
  kernel.setTargets("marching-orders.enemy-unit", [kernel.ref("enemy")]);
  const outcome = resolveChainBody(play.body, context(kernel));

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("ally").damage, 4);
  assert.equal(kernel.getObject("enemy").damage, 1);
});

test("sfd-114-221 Marching Orders golden: an intervening Might effect changes the damage read at resolution", () => {
  const kernel = world().unit("ally", { might: 1 }).unit("enemy", { owner: "B", might: 4 }).build();
  kernel.setTargets("marching-orders.friendly-unit", [kernel.ref("ally")]);
  kernel.setTargets("marching-orders.enemy-unit", [kernel.ref("enemy")]);
  const modified = runInstruction(might, {
    target: "marching-orders.friendly-unit", amount: 1, duration: "this-turn"
  }, { world: kernel });
  assert.equal(modified.result.status, "executed");
  const outcome = resolveChainBody(play.body, context(kernel));
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("ally").damage, 4);
  assert.equal(kernel.getObject("enemy").damage, 2);
});

test("sfd-114-221 Marching Orders golden: a stale enemy target ignores both Deals", () => {
  // 359.3.e.6-e.8 / .12: with the chosen unit gone, neither the Might read nor
  // the damage against it is replaced by a last-known value.
  const kernel = world()
    .unit("ally", { owner: "A", might: 3 })
    .unit("enemy", { owner: "B", might: 5 })
    .build();
  const stale = kernel.ref("enemy");
  kernel.perform({ type: "return-to-hand", object: stale });
  kernel.setTargets("marching-orders.friendly-unit", [kernel.ref("ally")]);
  kernel.setTargets("marching-orders.enemy-unit", [stale]);

  const outcome = resolveChainBody(play.body, context(kernel));

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map((entry) => entry.result), [
    { status: "ignored", reason: "mistargeted" },
    { status: "ignored", reason: "mistargeted" }
  ]);
  assert.equal(kernel.getObject("ally").damage, 0);
  assert.equal(outcome.events.length, 0);
});

test("sfd-114-221 Marching Orders golden: an enemy in a Base is not a legal battlefield target", () => {
  const kernel = world().base("ally", { might: 3 }).base("enemy", { owner: "B", might: 5 }).build();
  kernel.setTargets("marching-orders.friendly-unit", [kernel.ref("ally")]);
  kernel.setTargets("marching-orders.enemy-unit", [kernel.ref("enemy")]);
  const outcome = resolveChainBody(play.body, context(kernel));
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(entry => entry.result), [
    { status: "ignored", reason: "mistargeted" },
    { status: "ignored", reason: "mistargeted" }
  ]);
  assert.equal(kernel.getObject("ally").damage, 0);
  assert.equal(kernel.getObject("enemy").damage, 0);
  assert.deepEqual(kernel.events, []);
});

test("sfd-114-221 Marching Orders: the printed Repeat cost still fails closed at the production adapter", () => {
  assert.throws(() => translateCost(play.cost, program.canonicalCardId, "play"), error => {
    assert.equal(error.code, "judge-required");
    assert.match(error.message, /cost field keyword|Additional costs/);
    return true;
  });
});

test("sfd-114-221 Marching Orders: [Action] speed is derivable but the play adapter never reaches a draft", () => {
  // 806.1.b/806.1.c: [Action] is a permissive keyword the adapter already
  // understands (abilitySpeed returns 'action'), yet describePlay cannot build
  // the draft because translateCost refuses the printed Repeat component. Both
  // facts are asserted so neither half is misreported.
  const { judgeReason, ...binding } = program;
  const kernel = world().hand("orders", {
    cardId: program.canonicalCardId, types: ["spell"], energy: 3, power: null
  }).build();
  const source = kernel.getObject("orders");
  assert.equal(abilitySpeed(program.abilities, source), "action");
  assert.throws(
    () => describePlay(new ProgramRegistry([{ ...binding, status: "executable" }]),
      { type: "play", object: kernel.ref("orders"), player: "A" }, source),
    error => {
      assert.equal(error.code, "judge-required");
      assert.match(error.message, /Unsupported play cost field keyword/);
      return true;
    }
  );
});

test.todo(
  "sfd-114-221 Marching Orders: [Repeat] :rb_energy_3: — collecting the optional additional cost at " +
    "Finalize and executing the effect one extra time per paid instance with re-made choices " +
    "(820.1.b/820.1.d/820.2.a) needs the card-program adapter to bind the additional-cost field " +
    "(programs/play.ts currently rejects it) and a paid-instance count at resolution"
);

test.todo(
  "sfd-114-221 Marching Orders: the printed [Action] Showdown permission must be enforced through the " +
    "continuous.timing consumer and a CardProgram -> ChainDraft play adapter " +
    "(chain/engine.ts describePlay, contract 3.7) — abilitySpeed derives 'action', but describePlay " +
    "still rejects the additional-cost field before a draft exists"
);
