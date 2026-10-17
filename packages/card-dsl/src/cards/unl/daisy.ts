import type { Ability, CardProgram, Condition } from "../../ir/index.js";

/**
 * Daisy! (unl-196-219) — Unit，9 能量 + 2 Calm/Order Power、Might 8，
 * 标签 Ivern / Ionia / Signature。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，unl-196-219，逐字）：
 *   I enter ready.
 *   Reduce my cost by :rb_energy_1: for each of the following tags among your
 *   units — Bird, Cat, Dog, and Poro.
 *   When I attack while your units have all 4 tags, [Stun] an enemy unit here.
 *   (It doesn't deal combat damage this turn.)
 *
 * 规则依据（CR v1.5）：
 * - 143.4 / 359.2.c / 369.3：“I enter ready” 是入场状态改写（把“横置进场”替换成“就绪进场”），
 *   与 805.6 的 Accelerate 同族；不写成“先横置再 ready”。
 * - 356.4 / 356.4.b："Reduce my cost by [1] for each …" 是 Finalize 总费用阶段的减费，
 *   减费量为“你的单位中带 Bird、Cat、Dog、Poro 这些标签的数量”，最多 4（每个标签计一次）。
 *   356.4.e：本卡未印 minimum，折扣不引入额外下限。
 * - 133.8 / 133.8.a：四个名字是标签（tag），只在被文本引用时生效；“among your units” 的范围是
 *   能力控制者（740.1.a 的 "your"），而且计数是**跨单位并集、按标签去重**（同一单位同时有
 *   Bird 与 Cat 只计两个标签各一次，最多 4）。
 * - 383.4.e / 383.4.e.1 / 466.2.c："When I attack" 是 Attack Trigger（单位取得 Attacker 身份
 *   时入链），封闭时点表用 attack-declared。
 * - 383.2.a / 383.2.a.1：附加条件句紧跟在触发条件之后时属于触发条件的一部分。原文的
 *   "while your units have all 4 tags" 直接跟在 "When I attack" 之后，因此在触发时求值：
 *   不满足那次攻击不触发，满足后即使响应中标签条件变化能力仍会结算（383.2.c）。
 *   程序把它写成 TriggerSpec.condition。
 * - 355.9 / 355.10 + 053.3：“an enemy unit here” 是单个选目标（controller 限制为 opponent，
 *   位置与来源相同）；424.1 / 424.1.a：Stun 是效果型受限动作，effect.stun 已合入。
 *   括注 “(It doesn't deal combat damage this turn.)” 是 424.1.b 的提醒文本。
 *
 * status 判定（README 第 2 节，2026-10-17 逐条对源码复核）：judge-required ——
 * 三处当前缺口，均以实测证据记录，不近似实现：
 * 1. 减费不是可执行路径：programs/statics.ts 的 layerFor 对 static effect kind
 *    "cost.modify" 抛 ProgramBindingError（"Static ability kind cost.modify has no layer
 *    mapping"，实测），cost/cost-plan.ts 只在调用方显式传入 CostPlanInput.discounts 时应用
 *    减费，Finalize 也不读卡牌静态费用效果。
 * 2. “按你的单位中 Bird/Cat/Dog/Poro 的去重标签数”没有跨对象并集谓词：已合入的
 *    ObjectFilter.tags 是同一对象上的 every 匹配（layers/filter.ts），CountExpr 的 subject 只
 *    是标签、不参与求值，evaluateExpression 直接返回 queryObjects(filter).length。实测本卡
 *    形状只带 filter { player: "controller" }，在“A 有 Bird 单位与 Cat 单位、B 有同时带两
 *    个标签的单位”的局面下求值为 3（正确并集语义是 2，且不应包含对手单位）——即该声明会
 *    静默给出错误数量，而不是 fail closed。
 * 3. 「an enemy unit here」的动态位置锚点仍不可绑定：目标过滤里的 sameLocationAs 会被
 *    programs/filters.ts 的 translateObjectFilter 以 "Unsupported filter field
 *    sameLocationAs" 拒绝（实测），因此 attack-declared 触发无法经 registerProgramTriggers
 *    注册；effect.stun 本体与解释器侧 queryObjects 的 sameLocationAs 解析已合入（golden 覆盖）。
 * 依赖：静态 cost.modify 的图层/费用计划消费、跨对象标签并集计数谓词（契约变更请求）、
 * 以及程序绑定器的动态位置锚点支持。
 */

/**
 * “your units have all 4 tags” 的保留形状：真实语义是“你控制的单位中，Bird、Cat、Dog、Poro
 * 这 4 个标签各自的并集命中数 ≥ 4”（跨对象并集、按标签去重）。已合入的过滤器只能表达同一对象上
 * 的 tags every 匹配，因此 subject 名记录真实语义，filter 只标注能力控制者（同 wily-newtfish /
 * Ivern 的占位写法），不把并集近似成“一个单位有四个标签”或“有 4 个单位”。
 */
const UNITS_HAVE_ALL_FOUR_TAGS: Condition = {
  kind: "compare",
  left: {
    kind: "count",
    subject: "controller-units-distinct-listed-tags-union",
    filter: { player: "controller" }
  },
  operator: "gte",
  right: { kind: "constant", value: 4 }
};

const abilities: Ability[] = [
  {
    // 143.4 / 359.2.c / 369.3：“I enter ready” 是入场替代。
    kind: "replacement",
    replaces: {
      event: "object-enters-board",
      filter: { source: "self", exhausted: true }
    },
    with: [
      {
        id: "daisy.enter-ready",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      }
    ]
  },
  {
    // 356.4 / 356.4.b：减费声明（amount = 每个所列标签 1 点能量，最多 4；消费方缺口见 judgeReason 第 2 点）。
    kind: "static",
    effect: {
      kind: "cost.modify",
      appliesTo: "self",
      resource: "energy",
      amount: {
        kind: "count",
        subject: "controller-units-distinct-listed-tags-union",
        filter: { player: "controller" }
      },
      stage: "discount",
      // 356.4.b 的“每个 … 1 点”形式；上限由所列标签数量（4）给出，不是凭空钳制。
      maximum: { kind: "constant", value: 4 }
    }
  },
  {
    // 383.4.e 的攻击触发 + 383.2.a 的触发条件（“while your units have all 4 tags”）。
    kind: "triggered",
    trigger: {
      at: "attack-declared",
      filter: { event: "attack-declared", filter: { source: "self" } },
      condition: UNITS_HAVE_ALL_FOUR_TAGS
    },
    optional: false,
    body: [
      {
        id: "daisy.stun-enemy-here",
        op: "effect.stun",
        args: { target: { kind: "constant", value: "daisy.enemy-here" } },
        targets: [
          {
            id: "daisy.enemy-here",
            // 355.9 的选目标 + 053.3 的 "here" 位置锚点。
            filter: {
              type: "unit",
              zone: "board",
              controller: "opponent",
              sameLocationAs: "source"
            },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-feadeed8b5695723dd7f149d233160c40dea1625510f9fd7eb248c153d97e305",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处当前缺口，均以实测证据记录，不近似实现：(1)「Reduce my cost by [1] …」不是可执行路径：" +
    "programs/statics.ts 的 layerFor 对 static effect kind \"cost.modify\" 抛 ProgramBindingError（\"no layer mapping\"，实测），" +
    "cost/cost-plan.ts 只在调用方显式传入 CostPlanInput.discounts 时应用减费，Finalize 不读卡牌静态费用效果。" +
    "(2)「your units have all 4 tags」的去重标签并集计数没有谓词支持：ObjectFilter.tags 是同一对象上的 every 匹配，" +
    "CountExpr 的 subject 不参与求值（evaluateExpression 直接返回 queryObjects(filter).length）；实测本卡形状" +
    "（filter 只有 { player: \"controller\" }）在「A 有 Bird 单位与 Cat 单位、B 有同时带两标签的单位」时求值为 3，" +
    "正确并集语义是 2——该声明会静默给出错误数量而不是 fail closed，故不能据此标 executable。" +
    "(3)「an enemy unit here」的动态位置锚点仍不可绑定：目标过滤的 sameLocationAs 被 programs/filters.ts 的 " +
    "translateObjectFilter 以 \"Unsupported filter field sameLocationAs\" 拒绝（实测），attack-declared 触发因此无法经 " +
    "registerProgramTriggers 注册；effect.stun 本体与解释器侧 sameLocationAs 解析已合入并由 golden 覆盖。" +
    "依赖：静态 cost.modify 的图层/费用计划消费、跨对象标签并集计数谓词（契约变更请求）、程序绑定器的动态位置锚点支持。",
  abilities,
  sourceText:
    "I enter ready.\n" +
    "Reduce my cost by :rb_energy_1: for each of the following tags among your units — Bird, Cat, Dog, and Poro.\n" +
    "When I attack while your units have all 4 tags, [Stun] an enemy unit here. (It doesn't deal combat damage this turn.)"
} satisfies CardProgram;
