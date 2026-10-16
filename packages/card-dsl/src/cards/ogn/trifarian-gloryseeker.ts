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
 * status = judge-required。见 judgeReason。
 */
const trifarianGloryseeker = {
  canonicalCardId: "card.hash-0e5542d49264324b5497b244de3b3ad36381c763af055108066e1b17f7fb2aa7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺两件已合入依赖：(1) [Legion] 的依赖能力激活条件（812.1.c「本回合已由你结算另一张与本卡不同的牌」）" +
    "只能写成 count + filter 形状（对照 ogn/dangerous-duo.ts），而 condition.history / condition.predicate " +
    "对卡牌程序没有已注册的实现，HistoryQuery 也没有 812.1.c 需要的按卡身份排除字段" +
    "（契约 3.8 已登记该缺口，实现未落地，见 effects/interpreter/history.ts 的键白名单）；" +
    "(2)「buff me」不是目标（355.10.d.1：按特征程序化选中、不存在选择过程），但已合入的 effect.buff " +
    "只能从 ctx.targets(TargetSpec id) 读取对象，没有 source/pick/query 形式的自身选择器；" +
    "用 TargetSpec 包装会错误登记「成为目标」（755 类触发、Deflect 类目标税），故不这样近似。" +
    "依赖：RIFT-82（kw-deathknell-legion 展开）、Legion 条件历史查询落地、effect.buff 的非目标选择形状。",
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
