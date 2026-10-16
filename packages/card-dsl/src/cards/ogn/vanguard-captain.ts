import type { CardProgram } from "../../ir/index.js";

/**
 * Vanguard Captain (ogn-218-298) — Unit, 3 energy + 1 Order power, Might 3。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-218-298）：
 *   [Legion] — When you play me, play two 1 :rb_might: Recruit unit tokens here.
 *   (Get the effect if you've played another card this turn.)
 *
 * 规则依据（CR v1.5）：
 * - 812 Legion：依赖型关键词；812.1.b.1/812.1.c/812.2（与本文件外的 Trifarian Gloryseeker 同源）。
 * - 「When you play me」：card-played 时点、来源为自身（383/420.4.a）。
 * - 「play two … tokens here」：新 token 被「打出」时先在链上生成再走打出流程
 *   （440.2.c、185.2.a、350.2、354），由 effect.token 的 mode "play" 交付；Recruit 是
 *   CR 187.1 的 1 Might 单位 token（effect.token 定义 id "recruit"）。
 * - 「here」是来源执行指令时的位置（359.3.f.1/f.2 referent）。
 *
 * 结构：keyword 声明 + card-played 触发；body[0] 用 condition.value 读来源位置并写链接值 here，
 * body[1] 用 effect.token 打出 2 个 Recruit token（amount 2），linkedTo 前一条指令。
 *
 * status = judge-required：token 部分是已支持的（golden 用解释器真实执行），但 Legion 的激活条件
 * 缺已合入的历史查询与关键词展开（同 Trifarian Gloryseeker），整卡不能宣称可执行。
 */
const vanguardCaptain = {
  canonicalCardId: "card.hash-a6aafcc461fa5b268158126142402b9ead1ed267a31499c8ae62e16387e3f39c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Legion 依赖能力的激活条件：[Legion] 的展开（effects/keywords/Legion.ts）依赖 condition.predicate / " +
    "condition.history 与按卡身份的排除字段（812.1.c「与本卡不同」），而卡牌程序侧没有已注册的 " +
    "condition.history 实现，HistoryQuery 也没有该排除维度（契约 3.8 已登记、实现未落地）；" +
    "触发条件只能用 count + filter 的描述形状（对照 ogn/dangerous-duo.ts），不能宣称可执行。" +
    "依赖：RIFT-82（kw-deathknell-legion 展开）与 Legion 条件查询落地。" +
    "「play two 1 Might Recruit tokens here」部分已用 effect.token（mode play）+ condition.value " +
    "的链接位置表达，并有 golden 真实执行证据。",
  abilities: [
    { kind: "keyword", keyword: "legion" },
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { source: "self" } },
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "cards-finalized-this-turn",
            filter: { player: "controller", exclude: "self" }
          },
          operator: "gte",
          right: { kind: "constant", value: 1 }
        }
      },
      optional: false,
      body: [
        {
          id: "vanguard-captain.read-here",
          op: "condition.value",
          args: {
            value: {
              kind: "object-property",
              object: "source",
              property: "location"
            },
            key: { kind: "constant", value: "here" }
          }
        },
        {
          id: "vanguard-captain.play-two-recruits",
          op: "effect.token",
          linkedTo: "vanguard-captain.read-here",
          args: {
            token: { kind: "constant", value: "recruit" },
            amount: { kind: "constant", value: 2 },
            mode: { kind: "constant", value: "play" },
            location: {
              kind: "linked-value",
              instructionId: "vanguard-captain.read-here",
              key: "here"
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Legion] — When you play me, play two 1 :rb_might: Recruit unit tokens here. " +
    "(Get the effect if you've played another card this turn.)"
} satisfies CardProgram;

export default vanguardCaptain;
