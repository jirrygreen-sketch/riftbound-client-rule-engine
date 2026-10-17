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
 * status 判定（README 第 2 节）：judge-required —— 两处当前依赖仍未闭合，均不近似实现：
 * 1. 减费没有可执行入口：cost/ 的费用计划只在调用方显式传入 discounts 时应用减费
 *    （cost/cost-plan.ts 读 CostPlanInput.discounts），没有把 CardProgram 的 cost.modify 接进
 *    Finalize 的路径；且“按你的单位中 Bird/Cat/Dog/Poro 的去重标签数”需要跨对象并集计数谓词
 *    （同 Ivern 的判定），已合入的 ObjectFilter.tags 是同一对象上的 every 匹配。
 * 2. attack-declared 的 TriggerRegistration 与 effect.stun 本体已经有生产绑定路径，但目标
 *    过滤中的 sameLocationAs 动态锚点仍不能由当前程序绑定器锁定；触发条件也依赖同一并集谓词。
 * 程序保留减费声明（cost.modify 与并集占位形状）、触发与 Stun 的目标过滤；golden 用解释器与
 * 参考内核真实执行 effect.stun 部分与条件探针。
 *
 * 依赖：静态 cost.modify 到 Finalize 费用计划的消费、跨对象标签并集谓词、以及动态
 * sameLocationAs 目标锚点（契约变更请求）。
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
    "两处当前缺口，均不近似实现：(1)「Reduce my cost by [1] for each of the following tags among your units」虽已有 cost.modify 原语，" +
    "静态 cost.modify 尚未接入 Finalize 费用计划，" +
    "且「你的单位中 Bird/Cat/Dog/Poro 的去重标签数」需要跨对象并集计数——ObjectFilter.tags 仍是同一对象上的 every 匹配。(2) attack-declared 的触发注册与 effect.stun 本体已经合入，" +
    "但 sameLocationAs 动态目标锚点仍不能由当前程序绑定器锁定，触发条件也依赖同一并集谓词。不近似实现。",
  abilities,
  sourceText:
    "I enter ready.\n" +
    "Reduce my cost by :rb_energy_1: for each of the following tags among your units — Bird, Cat, Dog, and Poro.\n" +
    "When I attack while your units have all 4 tags, [Stun] an enemy unit here. (It doesn't deal combat damage this turn.)"
} satisfies CardProgram;
