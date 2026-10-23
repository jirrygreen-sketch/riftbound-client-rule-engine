import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/pyke-returned.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-409271324918d19e0c793fcbe4bce41cb7805a7f78155c1a3a115ce79c2140c2";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "[Backline] (I must be assigned combat damage last.)\n" +
  "Once each turn, when an enemy unit dies while I'm at a battlefield, play a Gold gear token exhausted. " +
  '(It has "[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.")';

const [hidden, backline, diesTrigger] = program.abilities;
const [playGold] = diesTrigger.body;

test("unl-145-219 Pyke, Returned: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-145-219 Pyke, Returned: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /Gold gear token/);
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /184\.1|185\.2\.d/);
  assert.match(program.judgeReason, /RIFT-62/);
  // 2026-10-18 re-sweep: the LKI binding is merged (pipeline passes the captured
  // last-known source into the condition context); the remaining condition gap
  // is the location predicate vocabulary, and the reason now says so.
  assert.match(program.judgeReason, /host\.testTrigger/);
  assert.match(program.judgeReason, /captured last-known/);
  assert.match(program.judgeReason, /LocationRef/);
  assert.match(program.judgeReason, /matchesObjectFilter/);
  assert.match(program.judgeReason, /Invalid effect\.token argument: exhausted/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.doesNotMatch(program.judgeReason, /触发注册生产方|没有生产方|RIFT-120/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("unl-145-219 Pyke, Returned golden: the printed Gold play creates the canonical token", () => {
  // 187.5: the token is defined and playable through the shared primitive.
  const kernel = world().build();
  const gold = runInstruction(token, playGold.args, { world: kernel });
  assert.equal(gold.result.status, "executed");
  assert.equal(gold.linked.goldToken.amount, 1);
  assert.equal(gold.linked.goldToken.createdAmount, 1);
  assert.equal(gold.linked.goldToken.blockedReason, undefined);
  const golds = gold.world.objects.filter(object => object.isToken);
  assert.equal(golds.length, 1);
  assert.equal(golds[0].name, "Gold");
  assert.deepEqual(golds[0].types, ["gear"]);
  assert.deepEqual(golds[0].location, { type: "base", player: "A" });
  assert.deepEqual(gold.events.map(event => [event.action, event.timingPoint]), [
    ["create-token", "chain-item-pending"],
    ["pay", "main-start"],
    ["play", "card-played"]
  ]);

  // 184.1 / 185.2.d: entry state is not an effect.token argument; passing one is
  // rejected outright rather than silently ignored.
  assert.throws(
    () => runInstruction(token, {
      ...playGold.args,
      token: { kind: "constant", value: "recruit" },
      exhausted: { kind: "constant", value: true }
    }, { world: world().build() }),
    /Invalid effect\.token argument: exhausted/
  );
});

test("unl-145-219 Pyke, Returned: the two location readers still disagree about \"at a battlefield\"", () => {
  // 383.2.a.1 keeps "while I'm at a battlefield" as a pre-chain trigger
  // condition. Evaluating it needs a "located at some battlefield" predicate:
  // the production ResolveContext.query only accepts an exact LocationRef while
  // the layer filter only accepts the generic spelling, so the authored
  // condition (count with location: "battlefield") never sees the source and
  // the layer reader would accept it for a unit in a Base as well.
  const kernel = world()
    .unit("onField", { owner: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("atBase", { owner: "A", location: { type: "base", player: "A" } })
    .build();
  const context = bindResolveContext(kernel, { source: kernel.getObject("onField"), controller: "A" });
  assert.deepEqual(context.query({ location: "battlefield" }).map(object => object.ref.id), []);
  assert.deepEqual(context.query({ location: { type: "battlefield" } }).map(object => object.ref.id), []);
  assert.deepEqual(
    context.query({ location: { type: "battlefield", id: "bf-1" } }).map(object => object.ref.id),
    ["onField"]
  );
  // The layer reader is the mirror image: it understands the generic
  // "at a battlefield" spelling and rejects the exact-ref one outright, so no
  // single spelling is shared by both readers.
  assert.equal(matchesObjectFilter({ location: "battlefield" }, kernel.getObject("onField")), true);
  assert.equal(matchesObjectFilter({ location: "battlefield" }, kernel.getObject("atBase")), false);
  assert.equal(matchesObjectFilter({ location: { type: "battlefield", id: "bf-1" } }, kernel.getObject("onField")), false);
});

test("unl-145-219 Pyke, Returned: [Hidden] and [Backline] bind at most one of their expansions", () => {
  // 811 / 826: the two keywords are declared, never re-implemented. Their
  // expansions are real IR, and the merged production binder accepts Backline's
  // continuous.combat registration while Hidden's cost.hidden declaration has
  // no layer mapping -- so the Hide action and the damage-assignment order are
  // both still unconsumed.
  const f = fixture({ cards: [] });
  const source = {
    ...f.kernel.getObject("source"),
    cardId: program.canonicalCardId,
    keywords: [],
    location: { type: "battlefield", id: "bf-1" }
  };
  const expanded = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  }).inspect(source).abilities;
  const statics = expanded.filter(ability => ability.kind === "static");
  assert.deepEqual(statics.map(ability => ability.effect.kind), ["cost.hidden", "continuous.combat"]);
  const binder = createEngineStaticBinder(f.engine);
  const outcomes = statics.map(ability => {
    try {
      binder.bindStatic(ability, source);
      return [ability.effect.kind, "bound"];
    } catch (error) {
      return [ability.effect.kind, error.message];
    }
  });
  assert.deepEqual(outcomes, [
    ["cost.hidden", "Static ability kind cost.hidden has no layer mapping"],
    ["continuous.combat", "bound"]
  ]);
});

test.todo(
  "unl-145-219 Pyke, Returned: evaluate \"while I'm at a battlefield\" against the captured " +
    "last-known source (CR 383.2.a.1 / 808.1.d.3) - the pipeline already binds the captured " +
    "snapshot into the condition context; the shared reader needs a \"located at some battlefield\" predicate"
);

test("unl-145-219 Pyke, Returned: [Hidden] and [Backline] are declared, not re-implemented", () => {
  // 契约 3.7 / README 第 5 节：关键词只声明；811 的 cost.hidden 与 826 的伤害分配顺序由
  // effects/keywords/Hidden.ts、effects/keywords/Backline.ts 展开。
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  assert.equal(hidden.value, undefined);
  assert.deepEqual(backline, { kind: "keyword", keyword: "backline" });
  assert.equal(backline.value, undefined);
});

test("unl-145-219 Pyke, Returned: 'once each turn' death trigger on an enemy unit", () => {
  assert.equal(diesTrigger.kind, "triggered");
  assert.equal(diesTrigger.optional, false);
  // 808.1.d / 429.1：死亡时点用封闭枚举的 object-killed。
  assert.equal(diesTrigger.trigger.at, "object-killed");
  assert.deepEqual(diesTrigger.trigger.filter, {
    event: "object-killed",
    // “an enemy unit dies”：事件对象是刚被消灭的单位，由本能力的对手控制（740.1.b）。
    object: { type: "unit", controller: "opponent" }
  });
  // 383.3.e.1：“Once each turn” 的每回合一次寿命（契约 3.5 的 TriggerSpec.once）。
  assert.equal(diesTrigger.trigger.once, "per-turn");
});

test("unl-145-219 Pyke, Returned: 'while I'm at a battlefield' is a pre-chain trigger condition", () => {
  // 383.2.a.1：紧跟触发条件的附加从句属于触发条件，不是效果的一部分。
  const condition = diesTrigger.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "objects");
  // 只用契约 3.6 的符号选择器（"self"）与位置拼写，不含运行时 ObjectRef。
  assert.deepEqual(condition.left.filter, {
    object: "self",
    location: "battlefield"
  });
});

test("unl-145-219 Pyke, Returned: the effect is one Gold-token play, with no target or pick", () => {
  assert.equal(diesTrigger.body.length, 1);
  assert.equal(playGold.id, "pyke-returned.play-gold-token");
  assert.equal(playGold.op, "effect.token");
  // 187.5 的 Gold 定义缺席（judgeReason）；440.2.c / 185.2.a 的“链上创建 + 打出”流程用 mode "play"。
  assert.deepEqual(playGold.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(playGold.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(playGold.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playGold.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  assert.deepEqual(playGold.args.linkKey, { kind: "constant", value: "goldToken" });
  // “exhausted” 是入场状态规定（184.1 / 185.2.d），没有被写成事后 effect.exhaust 或额外 IR 键。
  assert.deepEqual(Object.keys(playGold.args).sort(), [
    "amount",
    "linkKey",
    "location",
    "mode",
    "token"
  ]);
  assert.equal(playGold.targets, undefined);
  assert.equal(playGold.picks, undefined);
  assert.equal(playGold.linkedTo, undefined);
});

test.todo(
  "unl-145-219 Pyke, Returned: Gold gear token definition with its printed ability (CR 187.5) — " +
    "effect.token's frozen table has no gold entry, so mode \"play\" has no executable path"
);
test.todo(
  "unl-145-219 Pyke, Returned: chain creation plus the cost-waived play handoff " +
    "(CR 440.2.c / 185.2.a / 350.2 / 354) — RIFT-62 follow-up"
);
test.todo(
  "unl-145-219 Pyke, Returned: exhausted entry stipulation on the created token " +
    "(CR 184.1 / 185.2.d / 143.4) — create-token supports no entry-state override"
);
test.todo(
  "unl-145-219 Pyke, Returned: register the 'once each turn' death trigger and evaluate the " +
    "'while I'm at a battlefield' condition against the source's last-known location before the " +
    "trigger is queued (CR 383.2.a.1 / 383.3.e.1, 808.1.d.3) — host.testTrigger, the CardProgram -> " +
    "TriggerRegistration/lifecycle path and the captured last-known source binding are merged; the " +
    "remaining gap is the shared location-predicate spelling measured above"
);
