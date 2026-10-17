import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Seraphine, Not Alone (rad-138-167) — Unit, Order,
 * 5 energy / 1 power / 1 Might，标签 Piltover/Seraphine/Champion。
 *
 * sourceText (packages/card-data/data/deck-catalog.json, rad-138-167):
 *   "When you play me or when I become exhausted, play a 1 :rb_might: Recruit unit
 *    token to your base.
 *    I have +1 :rb_might: for each other exhausted unit you control."
 *
 * 规则依据（CR v1.5）：
 * - "When you play me"：card-played 时点（420.4.a）；"when I become exhausted"：
 *   object-exhausted 时点（415.1 从 Ready 变为 Exhausted；415.1.c 对已横置对象
 *   再横置时不产生。事件）。
 * - "play a 1 :rb_might: Recruit unit token to your base"：187.1 的 1 Might Recruit
 *   单位衍生物；"to your base" 是打出目的地（440.2.c/185.2.a 的被打出衍生物先在链上
 *   创建再由 play 交付），用 effect.token 的 play 模式 + locations 的 controller base
 *   （参考 Assembly Rig 的既有形状）；185.3 衍生物无费用。
 * - "I have +1 :rb_might: for each other exhausted unit you control"：持续 Might 加值
 *   （图层 arithmetic 层，契约 3.4）用 continuous.might；"for each" 是变量加值，
 *   原文的"每个"应写在 per（每个其他横置单位 +1）。
 *
 * 无法执行的依赖（保持 judge-required）：
 * - continuous.might 的图层消费方只读标量加值：layers/engine.ts 的 numberValue 只读
 *   amount/value/delta，continuous.might 的 per(count) 计数没有图层消费路径；
 *   0 / 3 个其他横置单位的正确 Might 结果保留为可运行 TODO。
 * - "for each other exhausted unit you control" 的 per.filter 内的 exclude/other
 *   相对锚点也需要静态计数过滤器消费方，不能以固定 +1 代替。
 * - effect.token 与解释器的参数形状尚未收敛：声明 body 经 runAbilityBody 会抛出
 *   "Invalid effect.token argument"，因此完整触发体结算仍保留 TODO。
 * - 触发注册与生命周期绑定路径已合入（src/programs/triggers.ts / lifecycle.ts，
 *   绑定测试验证两个触发都能注册，且自身横置经真实事件管线产生 Pending 能力）。
 */
const otherExhaustedUnits = {
  type: "unit",
  zone: "board",
  controller: "controller",
  states: "exhausted",
  exclude: "self"
} as const;

const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "seraphine-not-alone.play-recruit-on-play",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "recruit" },
          amount: { kind: "constant", value: 1 },
          mode: { kind: "constant", value: "play" },
          locations: { kind: "constant", value: [{ type: "base", player: "controller" }] },
          choiceId: { kind: "constant", value: "seraphine-not-alone.base" },
          linkKey: { kind: "constant", value: "recruitToken" }
        }
      }
    ]
  },
  {
    kind: "triggered",
    trigger: { at: "object-exhausted", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "seraphine-not-alone.play-recruit-on-exhaust",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "recruit" },
          amount: { kind: "constant", value: 1 },
          mode: { kind: "constant", value: "play" },
          locations: { kind: "constant", value: [{ type: "base", player: "controller" }] },
          choiceId: { kind: "constant", value: "seraphine-not-alone.base" },
          linkKey: { kind: "constant", value: "recruitToken" }
        }
      }
    ]
  },
  {
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      appliesTo: "self",
      amount: { kind: "constant", value: 1 },
      per: {
        kind: "count",
        subject: "units",
        filter: otherExhaustedUnits
      }
    }
  }
];

const program = {
  canonicalCardId: "card.hash-628d472ac3458206c95d893f3af0ac4bc4561ccd533988196a3c1c20ccd7eb20",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺 continuous.might 的变量图层消费方：\"I have +1 Might for each other exhausted" +
    " unit you control\" 是持续的变量 Might 加值，而 layers/engine.ts 的 numberValue 只读" +
    "标量（amount/value/delta），continuous.might 的 per(count) 计数及 per.filter 内的" +
    "exclude/other 相对锚点缺少静态计数消费方；正确的 0 / 3 个场景保留为 TODO，不以固定 +1 代替。" +
    "触发注册与生命周期绑定路径已合入（src/programs/triggers.ts / lifecycle.ts），" +
    "绑定测试验证两个触发都能注册，自身横置会产生 Pending 能力。" +
    "完整触发体还缺 effect.token 与解释器的参数桥：原始 body 经 runAbilityBody 抛出" +
    " Invalid effect.token argument，保留 TODO。" +
    "effect.token 的 Recruit 定义（187.1）与 play 模式已合入，黄金测试按声明形状隔离执行其中一个触发。" +
    "不近似实现。",
  abilities,
  sourceText:
    "When you play me or when I become exhausted, play a 1 :rb_might: Recruit unit token to your base.\n" +
    "I have +1 :rb_might: for each other exhausted unit you control."
} satisfies CardProgram;

export default program;
