import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/gust-monk.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import banish from "../../../../engine-core/dist/effects/instructions/effect.banish.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { KeywordGrantLayerEngine } from "../../../../engine-core/dist/programs/keyword-grants.js";

const CANONICAL_ID =
  "card.hash-ac392c4087040dcdd16d8c56b9819899610a8873fb5b8314becec875dc3ef0a1";
const SOURCE_TEXT =
  "You may pay :rb_energy_1: as an additional cost to play me.\n" +
  "When you play me, if you paid the additional cost, banish a card from any trash to give a unit " +
  "[Assault 2] this turn. (+2 :rb_might: while it's an attacker.)";

const [additionalCost, played] = program.abilities;
const [banishInstruction, assaultInstruction] = played.body;

const trashKernel = ({ owner }) => {
  const builder = world().player("A").player("B");
  builder.card("target-card", { zone: "trash", owner });
  return builder.build();
};

test("ven-101-166 Gust Monk: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-101-166 Gust Monk: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /cost\.additional/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /programs\/play\.ts/);
  assert.match(program.judgeReason, /item\.payment/);
  assert.doesNotMatch(program.judgeReason, /condition\.result 缺口|RIFT-359/);
});

test("ven-101-166 Gust Monk: the printed optional additional cost is declared", () => {
  assert.equal(additionalCost.kind, "static");
  assert.equal(additionalCost.effect.kind, "cost.additional");
  assert.equal(additionalCost.effect.id, "gust-monk.additional-cost");
  assert.equal(additionalCost.effect.appliesTo, "self");
  // 356.2.b / 356.2.b.1：「may … as an additional cost」是可选的追加费用。
  assert.equal(additionalCost.effect.optional, true);
  assert.equal(additionalCost.effect.stage, "optional-additional");
  assert.deepEqual(additionalCost.effect.payments, [
    { kind: "energy", amount: { kind: "constant", value: 1 } }
  ]);
});

test("ven-101-166 Gust Monk: the card-played ability gates on the real additional-cost result predicate", () => {
  assert.equal(played.kind, "triggered");
  assert.equal(played.trigger.at, "card-played");
  assert.deepEqual(played.trigger.filter, { event: "card-played", filter: { source: "self" } });
  assert.deepEqual(played.trigger.condition, {
    kind: "result",
    result: "additional-cost-paid",
    id: "gust-monk.additional-cost"
  });
});

test("ven-101-166 Gust Monk: banish a card from any trash, then grant Assault 2 this turn", () => {
  assert.deepEqual(
    played.body.map(instruction => [instruction.id, instruction.op]),
    [
      ["gust-monk.banish-a-card-from-any-trash", "effect.banish"],
      ["gust-monk.give-assault-2", "continuous.grant-keyword"]
    ]
  );

  // 355.10.c.1：[do X] to [do Y] 里的 “banish a card” 是指令内的费用，不是目标。
  assert.equal(banishInstruction.targets, undefined);
  assert.deepEqual(banishInstruction.args.objects, {
    kind: "constant",
    value: { pick: "gust-monk.card-in-any-trash" }
  });
  assert.equal(banishInstruction.picks.length, 1);
  const [pick] = banishInstruction.picks;
  assert.equal(pick.id, "gust-monk.card-in-any-trash");
  // 「any trash」：不限定拥有者/控制者。
  assert.deepEqual(pick.filter, { zone: "trash" });
  assert.equal(pick.filter.owner, undefined);
  assert.equal(pick.selection, "one");
  assert.equal(pick.min, 1);
  assert.equal(pick.max, 1);

  // 807.1.c 的 [Assault 2] 授予，带 end-of-turn 期限（317.2.c 到期）。
  assert.equal(assaultInstruction.linkedTo, "gust-monk.banish-a-card-from-any-trash");
  assert.deepEqual(assaultInstruction.args.keyword, { kind: "constant", value: "assault" });
  assert.deepEqual(assaultInstruction.args.value, { kind: "constant", value: 2 });
  assert.deepEqual(assaultInstruction.args.duration, {
    kind: "constant",
    value: "end-of-turn"
  });
  assert.deepEqual(assaultInstruction.args.target, { kind: "constant", value: "gust-monk.unit" });
  assert.equal(assaultInstruction.targets.length, 1);
  assert.equal(assaultInstruction.targets[0].id, "gust-monk.unit");
  assert.deepEqual(assaultInstruction.targets[0].filter, {
    type: "unit",
    zone: "board"
  });
  assert.equal(assaultInstruction.targets[0].selection, "one");
});

test("ven-101-166 golden: a card in your own trash is really banished (428.1/428.2)", () => {
  const kernel = trashKernel({ owner: "A" });
  const run = runInstruction(banish, banishInstruction.args, {
    world: kernel,
    picks: { "gust-monk.card-in-any-trash": [kernel.ref("target-card")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("target-card").zone, "banishment");
  assert.equal(kernel.getObject("target-card").owner, "A");
  assert.doesNotThrow(() => assert.equal(run.linked["banished-for-assault"].count, 1));
});

test("ven-101-166 golden: 'any trash' also reaches an opponent's trash", () => {
  const kernel = trashKernel({ owner: "B" });
  const run = runInstruction(banish, banishInstruction.args, {
    world: kernel,
    picks: { "gust-monk.card-in-any-trash": [kernel.ref("target-card")] }
  });
  assert.equal(run.result.status, "executed");
  // 428.1/428.2：牌进入其**拥有者**的 Banishment，而不是施动者的。
  assert.equal(kernel.getObject("target-card").zone, "banishment");
  assert.equal(kernel.getObject("target-card").owner, "B");
  assert.deepEqual(kernel.objectsInZone("B", "banishment").length, 1);
  assert.deepEqual(kernel.objectsInZone("A", "banishment"), []);
});

test("ven-101-166 golden: an empty trash negates the banish instead of inventing a card", () => {
  const kernel = world().build();
  const run = runInstruction(banish, banishInstruction.args, { world: kernel, picks: {} });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.linked["banished-for-assault"].count, 0);
  assert.deepEqual(run.linked["banished-for-assault"].objects, []);
});

test.todo(
  "ven-101-166 Gust Monk: charge the optional 1-Energy additional cost (356.2.b / 356.2.b.1) — " +
    "cost.additional is declared, but programs/play.ts still rejects the CardProgram additional-cost " +
    "declaration and buildCostPlan only consumes a caller-supplied optionalAdditional"
);

test.todo(
  "ven-101-166 Gust Monk: decide 'if you paid the additional cost' (356.4.f.1) — the frozen Condition/Expr " +
    "predicate is merged, but card-played still needs the item's payment receipt injected into Resolve"
);

test(
  "ven-101-166 golden: the original body banishes a card and grants only the chosen unit Assault 2 until turn-end",
  () => {
    const base = world()
      .unit("gust-monk", { might: 2, location: { type: "battlefield", id: "bf-1" } })
      .unit("chosen-unit", {
        might: 3,
        combatRole: "attacker",
        location: { type: "battlefield", id: "bf-1" }
      })
      .card("trash-card", { zone: "trash", owner: "B" })
      .build();
    const kernel = base.clone({ sourceSnapshot: base.getObject("gust-monk") });
    const chosen = kernel.ref("chosen-unit");
    kernel.setTargets("gust-monk.unit", [chosen]);
    kernel.setPicks("gust-monk.card-in-any-trash", [kernel.ref("trash-card")]);

    // Exercise the supported effect body only. Additional-cost payment and its
    // receipt gate remain TODO; no payment receipt is fabricated here.
    const outcome = runAbilityBody(played.body, kernel);
    assert.equal(outcome.status, "executed");
    assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
      [banishInstruction.id, "executed"],
      [assaultInstruction.id, "executed"]
    ]);
    assert.equal(kernel.getObject("trash-card").zone, "banishment");
    assert.deepEqual(outcome.events.map(event => event.action), ["banish"]);
    assert.deepEqual(outcome.linkedValues[`${assaultInstruction.id}.granted.objects`], [chosen]);

    assert.equal(kernel.continuousEffects.length, 1);
    const [registration] = kernel.continuousEffects;
    assert.equal(registration.effect.layer, "ability");
    assert.equal(registration.effect.filter.objectId, "chosen-unit");
    assert.equal(registration.effect.effect.keyword, "assault");
    assert.equal(registration.effect.effect.keywordValue, 2);
    assert.deepEqual(registration.duration, { type: "end-of-turn" });
    const layers = new KeywordGrantLayerEngine(kernel.objects, {
      context: source => bindResolveContext(kernel, { source, controller: source.controller })
    });
    for (const entry of kernel.continuousEffects) {
      layers.addContinuous(entry.effect, entry.duration, entry.timestamp);
    }
    assert.deepEqual(layers.snapshot(chosen).keywords, [{ id: "Assault", value: 2 }]);
    assert.equal(layers.snapshot(chosen).might, 5);
    assert.deepEqual(layers.evaluate(kernel.ref("gust-monk")).keywords, []);
    assert.deepEqual(layers.expireAt("turn-end"), [registration.effect.id]);
    assert.deepEqual(layers.snapshot(chosen).keywords, []);
    assert.deepEqual(layers.snapshot(kernel.ref("gust-monk")).keywords, []);
  }
);
