import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/kennen-storm-of-shuriken.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { assertTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createEngineStaticBinder, createProgramBinding, translateTriggerFilter } from "../../../../engine-core/dist/programs/index.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";

const CANONICAL_ID =
  "card.hash-f8e2a3619f710bd235f910a96127e6c5f05eb8a3971f892d3d728bab7dc7d677";
const SOURCE_TEXT =
  "When you play me, [Burn 2]. (Put the top 2 cards of your Main Deck into your trash.)\n" +
  "When I conquer, give a spell in your trash [Flow] equal to its cost this turn. " +
  "(You may play it from your trash for its Flow cost. Then banish it.)";

const [onPlay, onConquer] = program.abilities;
const [burn] = onPlay.body;
const [grantFlow] = onConquer.body;

const deckIds = (kernel, player = "A") =>
  kernel.zoneSlice(player, "deck", "top").map((object) => object.ref.id);
const trashIds = (kernel, player = "A") =>
  kernel.zoneSlice(player, "trash", "top").map((object) => object.ref.id);

test("ven-113-166 Kennen, Storm of Shuriken: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-113-166 Kennen: identity, ruleset, status, judgeReason and exact source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // Flow 半段与 conquer 发射都缺消费方；Burn 半段已可执行。
  assert.match(program.judgeReason, /Invalid continuous\.grant-keyword argument: cost/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /conquer/);
  assert.doesNotMatch(program.judgeReason, /没有 continuous\.grant-keyword 原语|RIFT-120/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
});

test("ven-113-166 Kennen: the play trigger is a mandatory [Burn 2]", () => {
  assert.equal(program.abilities.length, 2);
  // 383.4.a.1 / 420.4.a："When you play me" 是 Play Effect，时点 card-played + 自身。
  assert.equal(onPlay.kind, "triggered");
  assert.equal(onPlay.trigger.at, "card-played");
  assert.deepEqual(onPlay.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(onPlay.trigger.condition, undefined);
  assert.equal(onPlay.optional, false);

  // 括号里的文字是 [Burn 2] 的提示文本（441.2），不是第二条能力。
  assert.equal(onPlay.body.length, 1);
  assert.equal(burn.id, "kennen-storm-of-shuriken.burn-2");
  assert.equal(burn.op, "effect.mill");
  assert.deepEqual(burn.args, { amount: { kind: "constant", value: 2 } });
  // 441.4：烧牌者缺省为能力控制者（190.6.d），不写 player / target / pick。
  assert.equal(burn.targets, undefined);
  assert.equal(burn.picks, undefined);
  assert.equal(burn.linkedTo, undefined);
  assert.equal(instructionDefinitionsById.get("effect.mill") !== undefined, true);
});

test("ven-113-166 Kennen: the conquer trigger grants Flow equal to the spell's cost", () => {
  // 383.4.c.1 / 473.2.a："When I conquer" 是 Conquer Effect。
  assert.equal(onConquer.kind, "triggered");
  assert.equal(onConquer.trigger.at, "conquer");
  assert.deepEqual(onConquer.trigger.filter, {
    event: "conquered",
    filter: { source: "self" }
  });
  assert.equal(onConquer.optional, false);

  assert.equal(onConquer.body.length, 1);
  assert.equal(grantFlow.id, "kennen-storm-of-shuriken.grant-flow");
  // 829.1：Flow 是关键词；动态 Flow 费用仍受消费方/契约字段限制。
  assert.equal(grantFlow.op, "continuous.grant-keyword");
  assert.deepEqual(grantFlow.args.keyword, { kind: "constant", value: "Flow" });
  // 829.1.c.1："equal to its cost" 是备选费用替换基础费用的取值。
  assert.deepEqual(grantFlow.args.cost, {
    kind: "constant",
    value: { kind: "cost.printed" }
  });
  assert.deepEqual(grantFlow.args.duration, { kind: "constant", value: "this-turn" });
  // "a spell in your trash"：公开区域里的法术牌，由玩家选定（355.7/355.10.a.1）。
  assert.deepEqual(grantFlow.targets, [
    {
      id: "kennen-storm-of-shuriken.spell-in-trash",
      filter: { type: "spell", zone: "trash", owner: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  // Flow 的 KeywordDef 与授予原语已合入；缺的是动态费用消费与离链替代接线。
  assert.notEqual(keywordDefinitionsById.get("Flow"), undefined);
  assert.notEqual(instructionDefinitionsById.get("continuous.grant-keyword"), undefined);
});

test("ven-113-166 Kennen golden: [Burn 2] moves the top 2 of the Main Deck to the trash in order", () => {
  // 441.1：恰好是牌库最上面的两张，且按顶到底顺序进入弃牌区。
  const kernel = world()
    .player("controller")
    .deck(["top", "second", "third", "fourth"], { owner: "controller" })
    .build()
    .clone({ controller: "controller" });

  const outcome = resolveChainBody(onPlay.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [["kennen-storm-of-shuriken.burn-2", "executed"]]
  );
  assert.deepEqual(trashIds(kernel, "controller"), ["top", "second"]);
  assert.deepEqual(deckIds(kernel, "controller"), ["third", "fourth"]);
  assert.deepEqual(kernel.events.map((event) => event.action), ["mill"]);
  assert.equal(outcome.results[0].result.linkedValues.burnedCount, 2);
  assert.deepEqual(
    outcome.results[0].result.linkedValues.burned.map((ref) => ref.id),
    ["top", "second"]
  );
});

test("ven-113-166 Kennen golden: a short Main Deck burns as many cards as possible (CR 441.4)", () => {
  const kernel = world()
    .player("controller")
    .deck(["only-card"], { owner: "controller" })
    .build()
    .clone({ controller: "controller" });

  const outcome = resolveChainBody(onPlay.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.burnedCount, 1);
  assert.deepEqual(trashIds(kernel, "controller"), ["only-card"]);
  assert.deepEqual(deckIds(kernel, "controller"), []);
});

test("ven-113-166 Kennen golden: a replaced Burn negates the instruction and leaves the deck alone", () => {
  const kernel = world()
    .player("controller")
    .deck(["top", "second", "third"], { owner: "controller" })
    .build()
    .clone({ controller: "controller" });
  kernel.addReplacement((action) => (action.type === "mill" ? "prevented" : null));

  const outcome = resolveChainBody(onPlay.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, {
    status: "negated",
    reason: "skipped",
    events: outcome.results[0].result.events
  });
  assert.deepEqual(trashIds(kernel, "controller"), []);
  assert.deepEqual(deckIds(kernel, "controller"), ["top", "second", "third"]);
});

test("ven-113-166 Kennen probe: continuous.grant-keyword rejects the cost argument the card needs", () => {
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const kernel = world().player("A").player("B")
    .unit("kennen", { cardId: program.canonicalCardId, types: ["unit"], zone: "board", location: { type: "base", player: "A" } })
    .unit("spell", { owner: "A", controller: "A", types: ["spell"], zone: "trash", energy: 3, power: null, location: null })
    .build();
  // The optional parameter carrier does not exist, so this card body fails the
  // primitive's own argument schema before any resolution can happen.
  assert.throws(
    () => instructionDefinitionsById.get("continuous.grant-keyword").argsSchema.parse(grantFlow.args),
    /Invalid continuous\.grant-keyword argument: cost/
  );
  assert.ok(kernel.getObject("spell"));
  assert.equal(grantFlow.targets[0].filter.zone, "trash");
});

test("ven-113-166 Kennen probe: Flow's merged expansion cannot bind its cost static or its banish replacement", () => {
  const kernel = world().player("A").player("B")
    .unit("spell", { types: ["spell"], zone: "trash", energy: 3, power: null, location: null })
    .deck(["A:d"], { owner: "A" }).deck(["B:d"], { owner: "B" })
    .rune(["A:r"], { owner: "A" }).rune(["B:r"], { owner: "B" })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => kernel.choose(request),
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  const binder = createEngineStaticBinder(engine);
  const flow = keywordDefinitionsById.get("Flow");
  const [costStatic, replacement] = flow.expand({
    host: { canonicalCardId: CANONICAL_ID },
    params: { cost: { kind: "explicit", energy: { kind: "constant", value: 3 } } }
  });
  assert.equal(costStatic.effect.kind, "flow.cost");
  assert.throws(
    () => binder.bindStatic(costStatic, kernel.getObject("spell")),
    error => error.code === "judge-required" && /Static ability kind flow\.cost has no layer mapping/.test(error.message)
  );
  assert.equal(replacement.replaces.event, "object-leaves-chain");
  assert.throws(
    () => binder.bindReplacement(replacement, kernel.getObject("spell")),
    /Unsupported replacement opcode: effect\.banish/
  );
});

test("ven-113-166 Kennen probe: the legal conquered filter still needs source payload on emission", () => {
  const translated = translateTriggerFilter(onConquer.trigger.filter, "kennen-1", "conquer");
  assert.deepEqual(translated, { event: "conquered", object: { objectId: "kennen-1" } });
  assert.doesNotThrow(() => assertTriggerSpec({ at: "conquer", filter: translated }));

  const kernel = world().unit("kennen-1", {
    cardId: CANONICAL_ID,
    types: ["unit"],
    zone: "board",
    location: { type: "battlefield", id: "A-bf-1" }
  }).build();
  // turn/flow.ts currently emits only player/details for conquer, so the
  // source:self selector cannot match the real production payload.
  assert.equal(matchesTriggerEvent(
    translated,
    { kind: "conquer", player: "A", details: { battlefieldId: "A-bf-1" } },
    "A"
  ), false);
  assert.equal(matchesTriggerEvent(
    translated,
    { kind: "conquer", object: kernel.getObject("kennen-1"), player: "A", details: { battlefieldId: "A-bf-1" } },
    "A"
  ), true);
});
