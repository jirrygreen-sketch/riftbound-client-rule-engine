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
 * status 判定（README 第 2 节）：judge-required —— 四处依赖未合入，均不近似实现：
 * 1. “I enter ready” 是入场替代（143.4 / 359.2.c / 369.3），replacement.enter 没有已合入的
 *    消费管线（events 的替代注册表没有 CardProgram → ReplacementRegistration 的路径），
 *    effect.ready 不能事后模拟。
 * 2. 减费没有可执行入口：cost/ 的费用计划只在调用方显式传入 discounts 时应用减费
 *    （cost/cost-plan.ts 读 CostPlanInput.discounts），没有把 CardProgram 的 cost.modify 接进
 *    Finalize 的路径；且“按你的单位中 Bird/Cat/Dog/Poro 的去重标签数”需要跨对象并集计数谓词
 *    （同 Ivern 的判定），已合入的 ObjectFilter.tags 是同一对象上的 every 匹配。
 * 3. attack-declared 时点没有已合入发射方（combat 流程属引擎批 5 / RIFT-31/33/77），且卡牌
 *    触发未注册进 TriggerRegistration（引擎批 4 / RIFT-120）。
 * 4. 触发条件 “while your units have all 4 tags” 用的是同一并集谓词（见第 2 点）。
 * 程序保留减费声明（cost.modify 与并集占位形状）、触发与 Stun 的目标过滤；golden 用解释器与
 * 参考内核真实执行 effect.stun 部分与条件探针。
 *
 * 依赖：RIFT-89/90（费用计划接线与跨对象谓词）、RIFT-120（入场替代 + 攻击时点 + 触发注册）、
 * 跨对象标签并集谓词（契约变更请求）。
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
    // 143.4 / 359.2.c / 369.3：“I enter ready” 是入场替代（管线缺口见 judgeReason 第 1 点）。
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
    "四处依赖未合入：(1)「I enter ready」是入场替代（143.4/359.2.c/369.3），但 replacement.enter " +
    "没有已合入的消费管线——events 的替代注册表没有 CardProgram → ReplacementRegistration 的路径，" +
    "effect.ready 不能事后模拟（会多产生一次\"成为就绪\"事件）。(2)「Reduce my cost by [1] for each of the " +
    "following tags among your units」需要在 Finalize 应用减费，但 cost/cost-plan.ts 只在调用方显式传入 " +
    "discounts 时生效，没有 CardProgram → CostPlan 的接线（RIFT-89），也没有 cost.modify 原语；" +
    "且「你的单位中 Bird/Cat/Dog/Poro 的去重标签数」需要跨对象并集计数——已合入的 ObjectFilter.tags " +
    "是同一对象上的 every 匹配，无法表达「每个标签分别被某个单位拥有」。(3) attack-declared 时点没有" +
    "已合入发射方（combat 流程属引擎批 5 / RIFT-31/33/77），卡牌触发也未注册进 TriggerRegistration" +
    "（引擎批 4 / RIFT-120）。(4) 触发条件「while your units have all 4 tags」使用同一并集谓词。" +
    "程序保留减费的 count/subject 并集形状与 maximum 4、攻击触发与 Stun 的目标过滤（sameLocationAs 锚点）；" +
    "golden 用解释器与参考内核真实执行 effect.stun 与条件探针，其余缺口写 test.todo。依赖：RIFT-89/90、" +
    "RIFT-120、跨对象标签并集谓词（契约变更请求）。不近似实现。",
  abilities,
  sourceText:
    "I enter ready.\n" +
    "Reduce my cost by :rb_energy_1: for each of the following tags among your units — Bird, Cat, Dog, and Poro.\n" +
    "When I attack while your units have all 4 tags, [Stun] an enemy unit here. (It doesn't deal combat damage this turn.)"
} satisfies CardProgram;
