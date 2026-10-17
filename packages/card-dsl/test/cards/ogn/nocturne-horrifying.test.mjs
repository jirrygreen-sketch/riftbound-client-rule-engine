import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/nocturne-horrifying.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));
const { runAbilityBody } = await import(new URL("effects/interpreter.js", engineCore));
const { world } = await import(new URL("effects/testing/index.js", engineCore));
const keywords = await import(new URL("effects/keywords/registry.generated.js", engineCore));

const CANONICAL = "card.hash-2d8f25416970f68a17656a4ad7384628767cc23866a689af4b1999391a436411";
const SOURCE_TEXT =
  "[Ganking] (I can move from battlefield to battlefield.)\n" +
  "When you look at cards from the top of your deck (and don't draw them) and see me, " +
  "you may play me for :rb_rune_rainbow:.";

const [keyword, triggered] = program.abilities;
const [optional] = triggered.body;
const [modifyCost, playSelf] = optional.args.body.value;

test("nocturne-horrifying: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("nocturne-horrifying: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // 9. 文本/规则冲突与缺原语都必须写进 judgeReason。
  assert.match(program.judgeReason, /370\.1\.c\.1/);
  assert.match(program.judgeReason, /cost\.(printed|modify)/);
  // Re-sweep: replacement registration and the cost.modify instruction are
  // merged; the secret-zone event and Finalize cost/play wiring are not.
  assert.doesNotMatch(program.judgeReason, /RIFT-260/);
  assert.match(program.judgeReason, /LITERAL_FIELDS/);
  assert.match(program.judgeReason, /CostPlan/);
  // The real look action carries an array; the event payload and nested
  // self identity each still need their own production adapter.
  assert.match(program.judgeReason, /look 动作使用 objects 数组.*未生成.*object 载荷/);
  assert.match(program.judgeReason, /嵌套 objectId:self.*未绑定.*来源 ID/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("nocturne-horrifying: [Ganking] is declared and expands through the merged keyword", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "ganking" });
  assert.equal(keyword.value, undefined);

  // CR 810.1.b: Ganking = "I may move to a battlefield from another battlefield".
  const ganking = keywords.keywordDefinitionsById.get("Ganking");
  assert.ok(ganking, "Ganking must be registered in the keyword registry");
  const [expanded] = ganking.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expanded.kind, "static");
  assert.equal(expanded.effect.kind, "continuous.movement");
  assert.equal(expanded.effect.permission, "battlefield-to-battlefield");
});

test("nocturne-horrifying: the look trigger subscribes to cards-looked-at for this card", () => {
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "cards-looked-at");
  // 128.4 / 383.2.c / 432.1.c: 查看牌库顶时点；“see me” 指被查看的对象是本卡。
  assert.deepEqual(triggered.trigger.filter, {
    event: "cards-looked-at",
    object: { objectId: "self" }
  });
  // 触发本身强制；“you may play me” 由 choice.optional 承担（355.1 / 契约 3.9）。
  assert.equal(triggered.optional, false);
});

test("nocturne-horrifying: the optional body replaces the base cost and plays the card", () => {
  assert.equal(triggered.body.length, 1);
  assert.equal(optional.op, "choice.optional");
  assert.equal(optional.linkedTo, undefined);
  assert.deepEqual(optional.args.body.kind, "constant");

  // CR 356.1.a: “play me for [Cost]” 替换 Base Cost；此处是一个六域均可支付的 Power。
  assert.equal(modifyCost.op, "cost.modify");
  assert.deepEqual(modifyCost.args.id, {
    kind: "constant",
    value: "nocturne-horrifying.alternate-cost"
  });
  assert.deepEqual(modifyCost.args.cost, {
    kind: "constant",
    value: {
      payments: [
        {
          kind: "power",
          amount: { kind: "constant", value: 1 },
          allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]
        }
      ]
    }
  });
  assert.deepEqual(modifyCost.args.linkKey, { kind: "constant", value: "plan" });

  // CR 420.3: 游戏效果指示的 Play 是 Limited Action；计划来自上一条指令。
  assert.equal(playSelf.op, "effect.play");
  assert.equal(playSelf.linkedTo, "nocturne-horrifying.alternate-cost");
  assert.deepEqual(playSelf.args.object, {
    kind: "object-property",
    object: "self",
    property: "ref"
  });
  assert.deepEqual(playSelf.args.cost, {
    kind: "linked-value",
    instructionId: "nocturne-horrifying.alternate-cost",
    key: "plan"
  });
});

test("nocturne-horrifying golden: the current cost.modify shape produces a real alternate CostPlan", () => {
  // The interpreter can already execute the merged cost primitive. The chain
  // adapter still rejects this same declaration because it does not unwrap the
  // primitive's literal id/cost/linkKey fields (the remaining production gap).
  const base = world()
    .card("nocturne", { zone: "deck", owner: "A", types: ["unit"], energy: 4, power: ["Chaos"] })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("nocturne") });
  const outcome = runAbilityBody([modifyCost], kernel);
  assert.equal(outcome.status, "executed");
  const plan = outcome.linkedValues["nocturne-horrifying.alternate-cost.plan"];
  assert.equal(plan.finalized, true);
  assert.deepEqual(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, [
    { amount: 1, allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"] }
  ]);
});

test("nocturne-horrifying evidence: the production chain adapter still rejects cost.modify literals", () => {
  const base = world()
    .card("nocturne", { zone: "deck", owner: "A", types: ["unit"], energy: 4, power: ["Chaos"] })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("nocturne") });
  assert.throws(
    () => resolveChainBody([modifyCost], kernel),
    /cost\.modify id must be a non-empty string \(or supply source\)/
  );
});

test("nocturne-horrifying golden: declining the option plays nothing", () => {
  const base = world().card("nocturne", { zone: "deck", owner: "A", types: ["unit"] }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("nocturne") });
  kernel.setAnswers({ "nocturne-horrifying.may-play/optional": false });

  const outcome = resolveChainBody(triggered.body, kernel);
  assert.deepEqual(outcome.results.map((entry) => entry.id), ["nocturne-horrifying.may-play"]);
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("nocturne").zone, "deck");
  assert.deepEqual(outcome.events, []);
});

test("nocturne-horrifying golden: the caller-supplied plan plays the looked-at card", () => {
  // 这段执行只证明 effect.play 的形状可用；费用改写（356.1.a）与“从被查看的牌库顶打出”
  // 的许可仍未接线，所以卡本身保持 judge-required。
  const base = world().card("nocturne", { zone: "deck", owner: "A", types: ["unit"] }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("nocturne") });
  kernel.setAnswers({ "nocturne-horrifying.may-play/optional": true });

  const outcome = resolveChainBody(
    [
      {
        id: "nocturne-horrifying.play-self",
        op: "effect.play",
        args: {
          object: { kind: "object-property", object: "self", property: "ref" },
          cost: { kind: "constant", value: { finalized: true, energy: 0, power: ["Chaos"], xp: 0 } },
          linkKey: { kind: "constant", value: "played" }
        }
      }
    ],
    kernel
  );
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("nocturne").zone, "board");
  assert.deepEqual(outcome.linkedValues["nocturne-horrifying.play-self.played"], 1);
  // 参考内核按 finalized plan 结算（计划只在 perform 入参里，事件载荷不带计划）。
  assert.deepEqual(kernel.events.map((event) => event.action), ["pay", "play"]);
});

test.todo(
  "nocturne-horrifying: 打出许可与位置校验（从被查看的牌库顶打出，420.3.b / 355.2）——" +
    "需要秘密区域的打出许可原语与消费方"
);

test.todo(
  "nocturne-horrifying: 356.1.a 的 cost.modify 已能在 interpreter 生成有效 CostPlan；" +
    "仍需 chain adapter 解包 id/cost/linkKey，并把该计划接入从秘密区域打出的 effect.play Finalize 流程"
);

test.todo(
  "nocturne-horrifying: 370.1.c.1 的秘密区域同刻替代（现有 replacement.event 可处理 card-revealed/reveal，look 的 objects→object 载荷与来源绑定仍缺）；" +
    "同时复核 CR 370.1.c.1 示例文本与本地 sourceText 的措辞冲突（需要裁定）"
);
