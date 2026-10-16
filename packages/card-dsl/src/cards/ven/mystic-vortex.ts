import type { CardProgram } from "../../ir/index.js";

/**
 * Mystic Vortex (ven-160-166) — Battlefield, Colorless.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-160-166，逐字）：
 *   "During showdowns here, cards with [Reaction] cost :rb_rune_rainbow: more to
 *    play. (Hidden cards have [Reaction].)"
 *
 * 规则依据（Core Rules v1.5）：
 * - 356.3："cost … more" 是「3. Determine Total Cost」里的费用增加步骤（356.4 是减费，
 *   356.3 是加费）；479.4.f 也把 "cost … less" / "cost … more" 一并列为算术层的识别短语。
 * - 135.2.e.5 / 135.2.e.5.a、163.2：:rb_rune_rainbow: 是任意域 Power [A]，作为费用可由
 *   任意域 Power 支付，因此「多 1 个 [A]」= 追加一条可由任意域 Power 支付的 Power 需求。
 * - 356.6：能源与 Power 费用下限 0 只约束减费，不阻止本条增加费用。
 * - 345 / 347 / 466.2.b：Showdown 是链与战斗流程中的具名状态（Showdown Open 时只有
 *   合法时机的牌可打出，347.1），"During showdowns here" 指的是在本战场开启的 Showdown；
 *   封闭时点 showdown-open / showdown-close（events/timing-points.ts，规则引用 345 / 347.2.a /
 *   466.2.b）是它的时点定义。053.3："here" 指本战场。
 * - 813.1 / 813.5：Reaction 是许可类关键词（813.1.c.1 允许在 Closed State 打出），
 *   且「是否拥有 Reaction」是可被引用的特征（813.5）；括号里的 "Hidden cards have
 *   [Reaction]" 是 811.6 + 813 的提示文本，不构成第二条能力。
 * - 190.6.a / 190.6.d：战场能力的控制者是战场控制者；但本条作用的是「在本战场期间
 *   打出的牌」，费用增加的对象是各次打出的费用计划，不是控制者自身。
 *
 * status = judge-required（缺口均不近似实现）：
 * 1. 没有已合入路径把这笔加费安装到后续那次打出的费用计划上：cost/cost-plan.ts 的
 *    CostPlanInput.increases 只消费调用方传入的组件（356.3），effects/instructions/ 也没有
 *    cost.modify 原语（RIFT-9 清单，属 RIFT-89 费用计划批次）。
 * 2. 门槛「在本战场进行的 Showdown 期间」没有可求值形状：Showdown 状态由 chain 拥有
 *    （chain/engine.ts 的 openShowdown/closeShowdown 与 showdown-open/close 时点），
 *    没有暴露给卡牌程序的查询；Battlefield 的 showdown 身份、以及「本战场是否为该次
 *    Showdown 的地点」也没有通道（layers/filter.ts 的 sameLocationAs 未实现）。
 * 3. 「cards with [Reaction]」是 813.5 的特征谓词，但已合入的过滤器不比较
 *    ObjectSnapshot.keywords（同 ogn/guerilla-warfare-teamo 记录的关键词谓词缺口）；
 *    Hidden 牌按 811.6 获得 Reaction 的部分还依赖 Hidden/facedown 机制（RIFT-84）。
 * 已支持部分由 golden 在真实费用计划上执行：356.3 的加费把费用从「无 Power 需求」变成
 * 「一条任意域 Power 需求」，且支付准备在 Rune Pool 不足时拒绝这次支付（357.1）。
 * 依赖：RIFT-89（cost.modify 与费用计划接线）、Showdown 状态查询与 sameLocationAs 锚点、
 * 关键词谓词（813.5）与 Hidden（RIFT-84）。
 */
export default {
  canonicalCardId: "card.hash-a4ce11641e7d44ba07514cd00f7c63e4ce2fa82ef76ff2dd5a8391481ba04da9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) 没有已合入路径把这笔加费安装到后续那次打出的费用计划上：" +
    "cost/cost-plan.ts 的 CostPlanInput.increases 只消费调用方传入的组件（356.3），" +
    "effects/instructions/ 也没有 cost.modify 原语（RIFT-9 清单，属 RIFT-89）；" +
    "(2) 门槛「在本战场进行的 Showdown 期间」不可求值：Showdown 状态由 chain/engine.ts 拥有" +
    "（showdown-open/showdown-close 时点，345/347.2.a/466.2.b），没有暴露给卡牌程序，" +
    "「本战场是该次 Showdown 的地点」也需要未实现的 sameLocationAs 锚点；" +
    "(3) 「cards with [Reaction]」是 813.5 的特征谓词，但已合入的过滤器不比较 ObjectSnapshot.keywords" +
    "（同 ogn/guerilla-warfare-teemo 的关键词谓词缺口），Hidden 牌按 811.6 获得 Reaction 还依赖 RIFT-84。" +
    "加费本身已由 golden 在真实费用计划上执行（追加一条任意域 Power 需求，135.2.e.5.a/163.2）。" +
    "依赖：RIFT-89、Showdown 状态查询与 sameLocationAs 锚点、关键词谓词与 RIFT-84（Hidden）。",
  abilities: [
    {
      kind: "static",
      effect: {
        // 356.3：费用增加步骤（"cost … more"，479.4.f 同列为算术层短语）。
        kind: "continuous.cost-modification",
        appliesTo: "play-cost",
        // ":rb_rune_rainbow: more"：追加一条可由任意域 Power 支付的 Power 需求
        // （135.2.e.5.a / 163.2；封闭六域集合没有 Universal Power 值）。
        resource: "power",
        amount: { kind: "constant", value: 1 },
        domains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"],
        // "cards with [Reaction]"：813.1 / 813.5 的特征谓词（811.6 让 Hidden 牌获得
        // Reaction 的提示文本不另立能力）；已合入的过滤器不比较 ObjectSnapshot.keywords，
        // 该键是描述性的 fail-closed 形态（同 ogn/guerilla-warfare-teemo，见 judgeReason 缺口 3）。
        filter: { keywords: ["Reaction"] }
      },
      // "During showdowns here"：345 / 347.2.a / 466.2.b 的 Showdown Open 状态加 053.3 的 here 地点，
      // 引擎没有把 Showdown 状态与战场身份暴露给卡牌程序的查询（见 judgeReason 缺口 2），
      // 以具名谓词占位，不写成硬编码恒真条件。
      condition: {
        kind: "expression",
        value: { kind: "constant", value: "showdown-open-at-source-battlefield" }
      }
    }
  ],
  sourceText:
    "During showdowns here, cards with [Reaction] cost :rb_rune_rainbow: more to play. " +
    "(Hidden cards have [Reaction].)"
} satisfies CardProgram;
