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
 * status = judge-required（复核 2026-10-17）：token 部分是已支持的（golden 用解释器 +
 * 生产链适配器真实执行），但 Legion 的激活条件缺可求值的触发条件路径与关键词/卡牌程序
 * 绑定（同 Trifarian Gloryseeker）：触发条件的 count 表达式不实现历史计数
 * （subject 在 expr.ts 里不参与求值，未知 filter 键被忽略），生产触发管线对带
 * condition 的触发要求宿主提供 testTrigger 适配器（只有测试 helper 安装它），
 * 也没有已合入路径把 CardProgram 的 triggered ability 注册成 TriggerRegistration
 * （RIFT-257）。触发拼写改用引擎验证器接受的 canonicalCardId 形式。
 */
const vanguardCaptain = {
  canonicalCardId: "card.hash-a6aafcc461fa5b268158126142402b9ead1ed267a31499c8ae62e16387e3f39c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Legion 依赖能力的激活条件未落地：(1) 触发条件只能写成 count + filter 的描述形状——count 表达式的 subject 在 " +
    "interpreter/expr.ts 里不参与求值（只按 filter 查询对象，未知 filter 键被忽略会过度满足），" +
    "condition.history 是结算期指令而不是触发条件求值路径，HistoryQuery 也没有 812.1.c 的按卡身份排除维度" +
    "（effects/keywords/Legion.ts 展开里的 excluding 载荷会被 history 解析器拒绝）；" +
    "(2) 生产触发管线对带 condition 的触发要求宿主提供 testTrigger 适配器（events/pipeline.ts 抛 " +
    "Trigger condition adapter required；只有 engine-core 测试 helper 安装它），" +
    "且没有已合入路径把 CardProgram 的 triggered ability 注册成 TriggerRegistration（RIFT-257）。" +
    "触发 filter 已改用引擎验证器接受的 canonicalCardId 形式。" +
    "「play two 1 Might Recruit tokens here」部分已用 effect.token（mode play）+ condition.value 的链接位置表达，" +
    "并有 golden 经生产链适配器真实执行。依赖：RIFT-82（Legion 条件查询落地）与 RIFT-257（卡牌触发绑定）。",
  abilities: [
    { kind: "keyword", keyword: "legion" },
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        // 引擎验证器拒绝 { filter: { source: "self" } } 拼写；本卡以 canonical
        // 身份标识自身（"When you play me"）。
        filter: {
          event: "card-played",
          object: { canonicalCardId: "card.hash-a6aafcc461fa5b268158126142402b9ead1ed267a31499c8ae62e16387e3f39c" }
        },
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
