import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Patched Porobot (ven-058-166) — Unit, Mind, Mech/Poro/Piltover.
 *
 * 原文：
 *   (I enter exhausted.)
 *   When you play me, if you control 3 or more other gear, draw 1.
 *
 * 规则依据（Core Rules v1.5）：
 * - "I enter exhausted"：143.4 规定单位默认以 exhausted 进入 Board；提示文字只是
 *   复述既有默认，没有产生额外能力，因此不是一条可执行能力文本。
 * - 383.4.a / 383.4.a.1："When you play me" 是 Play Effect（Condition 含本单位
 *   的触发式能力），420.4.a 规定它在打出完成后进链；时点 "card-played"，filter 用
 *   契约 3.6 的符号选择器正确指向自身。
 * - 383.2.a.1：Condition 之后紧跟的附加条件从句（这里 "if you control 3 or more
 *   other gear"）属于 Trigger Condition 本身，必须在触发时判定；所以写成
 *   TriggerSpec.condition，而不是 body 里某条指令的 condition。
 * - "other gear"：排除来源自身，用契约 3.6 的 exclude 选择器 "self" 表达
 *   （exclude 排除全部选中身份，与解释器 README 的 ObjectFilter 锚点一致）；
 *   "you control" 的 "you" 是能力控制者（190.6.d）。
 * - "draw 1" = effect.draw（414.1/414.3，已合入原语）。
 *
 * 结构说明：条件用 count 表达式（subject + filter）表达"你控制的、除我以外的 gear
 * 数量 ≥ 3"，阈值比较用 condition 的 compare；不手写状态、不假造 gear。
 * 触发器 filter 的 { source: "self" } 沿用仓库既有卡牌程序写法；把触发数据注册成
 * TriggerRegistration 并解析该自指锚点、在触发时求值 condition 的适配器仍未合入
 * （RIFT-120 后续），因此 golden 对端到端订阅保留 test.todo。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: {
        event: "card-played",
        filter: { source: "self" }
      },
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "gear",
          filter: {
            type: "gear",
            controller: "self",
            zone: "board",
            exclude: "self"
          }
        },
        operator: "gte",
        right: { kind: "constant", value: 3 }
      }
    },
    optional: false,
    body: [
      {
        id: "patched-porobot.draw",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-37be8a79ae257a86755648f6f57b5c8b689e0187de4789bc0eca92313a847abc",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities,
  sourceText:
    "(I enter exhausted.)\n" +
    "When you play me, if you control 3 or more other gear, draw 1."
} satisfies CardProgram;
