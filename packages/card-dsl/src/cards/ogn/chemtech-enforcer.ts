import type { CardProgram } from "../../ir/index.js";

/**
 * Chemtech Enforcer (ogn-003-298) — Unit, Fury, Zaun, energy 2, Might 2.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-003-298，逐字，含换行）:
 *   "[Assault 2] (+2 :rb_might: while I'm an attacker.)\nWhen you play me, discard 1."
 *
 * 规则依据（Core Rules v1.5）:
 * - 807.1.b / 807.1.b.3 / 807.1.c：Assault 带数值时为 "Assault 2"，功能上等于
 *   "While I am an attacker, I have +2 [M]"；807.1.d/807.1.d.1 要求
 *   Attacker designation 由 Combat 赋予并在保持期间持续生效。
 * - 420.4.a："When you play me" 在打出动作完成时触发；对应已合入时点 card-played
 *   （events/timing-points.ts，ruleRefs 359/383.4.a/407）。
 * - 423.1 / 423.1.b："discard 1" 的牌从手牌进入 Trash（可在此时点触发 "When I am
 *   discarded" 能力，本卡的自身触发由链/事件管线负责）；423.4：效果弃牌尽可能弃。
 * - 355.10.c：手牌弃牌选择是非目标 pick，不进 targets。
 *
 * 结构说明:
 * - abilities[0] 按契约 3.1 声明 Assault 2（不重写关键词逻辑）；
 * - abilities[1] 是 card-played 触发（filter 指向自身、玩家为控制者）的强制弃牌，
 *   body 只有一条 effect.discard（amount 1，默认弃牌者为 ctx.controller）。
 *
 * 未合入依赖（不近似实现）:
 * - Assault 的 KeywordDef 已合入（RIFT-81），但没有运行时消费方把 CardProgram 的
 *   keyword 能力展开（调用 KeywordDef.expand）并注册进图层；layers（RIFT-91）也不
 *   读取 Attacker designation（ObjectSnapshot 尚无 combatRole/designation，契约 3.8
 *   只冻结了字段设计），derived-might 仅覆盖官方目录程序，故无法声明整卡 executable。
 * - 触发 → 进链的卡牌程序接线属于 RIFT-120 之后的管线工作。
 * 依赖：RIFT-81、RIFT-91、RIFT-120。
 */
const chemtechEnforcer = {
  canonicalCardId: "card.hash-ed8cf6c764ed889b192049c35919693d1664dee6da3044cdb42dae8a561a5a59",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『When you play me, discard 1』可用已合入的 effect.discard（CR 423.1/423.4）并有执行测试；缺口在『[Assault 2]』：" +
    "KeywordDef（RIFT-81，CR 807）已合入但没有运行时消费方把卡牌程序的 keyword 能力展开并注册进图层，layers（RIFT-91）也不读取 " +
    "Attacker designation（ObjectSnapshot 无 combatRole/designation，契约 3.8 仅冻结字段设计），derived-might 只覆盖官方目录程序。" +
    "依赖：RIFT-81、RIFT-91、RIFT-120。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "assault", value: 2 },
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { source: "self", player: "controller" } }
      },
      optional: false,
      body: [
        {
          id: "chemtech-enforcer.discard",
          op: "effect.discard",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText: "[Assault 2] (+2 :rb_might: while I'm an attacker.)\nWhen you play me, discard 1."
} satisfies CardProgram;

export default chemtechEnforcer;
