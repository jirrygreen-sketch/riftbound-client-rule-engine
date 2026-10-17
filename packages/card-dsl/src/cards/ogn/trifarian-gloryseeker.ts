import type { CardProgram } from "../../ir/index.js";

/**
 * Trifarian Gloryseeker (ogn-217-298) — Unit, 2 energy, Might 2（无印刷 Power）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-217-298）：
 *   [Legion] — When you play me, buff me. (If I don't have a buff, I get a +1 :rb_might: buff.
 *   Get the effect if you've played another card this turn.)
 *
 * 规则依据（CR v1.5）：
 * - 812 Legion：依赖型关键词；812.1.b.1「If you have played another card this turn,
 *   this card gains [Text]」；812.1.c 要求同一回合里打出的牌必须「与本卡不同」；
 *   812.2 同一玩家打出一张牌即满足其控制的所有 Legion 实例。
 * - 「When you play me」：card-played 时点、来源为自身（383/420.4.a）。
 * - 「buff me」：Buff 标记（702.3/702.3.a/703；已带 Buff 的单位不再获得第二个，既不是错误也不重复放置）；
 *   契约把它交给 effect.buff 原语（mode buff）。
 *
 * 结构（契约 3.1/3.2/3.9）：
 * - abilities[0] 声明 { kind: "keyword", keyword: "legion" }（契约 3.1 关键词能力、§5 只声明）；
 * - abilities[1] 是 [Text] 本体：card-played 触发，触发条件用 count 表达式读「本回合已结算的、
 *   与本卡不同的牌」（812.1.c 的排除意图与 ogn/dangerous-duo.ts 的写法一致）。
 *
 * status = judge-required。见 judgeReason：
 * - [Legion] 的依赖能力激活条件（812.1.b.1「本回合已由你打出另一张与本卡不同的牌」）
 *   在冻结的 TriggerSpec.condition 里只能写成 count/compare 形状；已合入的
 *   condition.history 指令与 HistoryQuery.exclude（契约 3.8）是结算期指令，不能作为
 *   进链前的触发条件求值，而触发条件的 count 表达式不实现按历史/卡身份计数（subject
 *   不参与求值、filter 的 player 键也不是 ObjectFilter 字段），会过度激活；
 *   effects/keywords/Legion.ts 自身展开用的 excluding 载荷仍被 history 解析器拒绝
 *   （Unsupported history query field），按卡身份排除没有落地；
 * - 「buff me」不是目标（355.10.d.1），但已合入的 effect.buff 只能从 ctx.targets 读取
 *   对象；用 TargetSpec 包装会让链的 Finalize 发出 became-target 事件（错误登记目标），
 *   故不这样近似；
 * - 触发侧没有 CardProgram → TriggerRegistration 的订阅方（RIFT-257 进行中）。
 */
const trifarianGloryseeker = {
  canonicalCardId: "card.hash-0e5542d49264324b5497b244de3b3ad36381c763af055108066e1b17f7fb2aa7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Legion]（812.1.b.1/812.1.c）的激活条件不能落地：进链前的 TriggerSpec.condition 只能写成 count/compare，" +
    "而已合入的历史查询是结算期指令 condition.history（HistoryQuery 的 scope/action/player/exclude），不能用作触发条件；" +
    "触发条件的 count 表达式也不实现历史计数——subject（cards-finalized-this-turn）不参与求值、filter 的 player 键不是 ObjectFilter 字段，" +
    "按现状会过度激活（effects/keywords/Legion.ts 展开里的 excluding 载荷同样被 history 解析器拒绝：Unsupported history query field）。" +
    "「buff me」侧：不是目标（355.10.d.1 按特征程序化选中、不存在选择过程），但已合入的 effect.buff 只能从 ctx.targets(TargetSpec id) 读取对象，" +
    "没有 source/pick/query 形式的自身选择器；用 TargetSpec 包装会让链的 Finalize 发出 became-target 事件（错误登记「成为目标」），故不这样近似。" +
    "触发侧另缺 CardProgram → TriggerRegistration 的订阅方（RIFT-257 进行中）。" +
    "依赖：触发条件的历史查询（condition.history 作为触发条件求值）、HistoryQuery 的按卡身份排除、effect.buff 的非目标选择形状、RIFT-257。不近似实现。",
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
          id: "trifarian-gloryseeker.buff-me",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "self-unit" }
          },
          targets: [
            {
              id: "self-unit",
              filter: { object: "self", type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Legion] — When you play me, buff me. (If I don't have a buff, I get a +1 :rb_might: buff. " +
    "Get the effect if you've played another card this turn.)"
} satisfies CardProgram;

export default trifarianGloryseeker;
