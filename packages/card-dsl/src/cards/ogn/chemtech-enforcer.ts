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
 * - CardProgram keyword 展开、card-played trigger 绑定和 effect.discard 均已存在；
 *   剩余缺口是 Assault 的展开结果在图层中读取攻击身份。
 * - 即使展开接线完成，Assault 2 的展开（"+2 [M] while attacker"）条件读宿主
 *   attacker designation：designation 不在 layers 的 ObjectSnapshot 特征里，
 *   layers/engine.ts 的 conditionMatches 也不求值 compare 条件（未知 kind 按 true），
 *   条件在真实图层计算里既不能生效也不能正确关闭。derived-might 仅覆盖官方目录程序。
 * 依赖：designation 谓词与 compare 条件消费方，以及 Assault 展开结果的图层消费。
 */
const chemtechEnforcer = {
  canonicalCardId: "card.hash-ed8cf6c764ed889b192049c35919693d1664dee6da3044cdb42dae8a561a5a59",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "『When you play me, discard 1』可用已合入的 effect.discard（CR 423.1/423.4）并有执行测试；缺口在『[Assault 2]』：" +
    "KeywordDef.expand 与 CardProgram 的 keyword/trigger 绑定均已合入（CR 807）；" +
    "即使接线完成，展开读宿主 attacker designation，而 designation 不在 layers 的 ObjectSnapshot 特征里、layers/engine.ts 的 conditionMatches 不求值 compare 条件" +
    "（未知 kind 按 true），+2 [M] 条件在真实图层计算中无法只在我攻击时生效。derived-might 只覆盖官方目录程序。" +
    "依赖：designation 谓词与 compare 条件消费方，以及 Assault 展开结果的图层消费。不近似实现。",
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
