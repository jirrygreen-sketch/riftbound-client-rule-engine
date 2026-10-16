import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Lulu, Whimsical (rad-110-167) — Unit, 3 Energy, Might 3, Chaos,
 * tags Yordle/Bandle City/Lulu/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-110-167，逐字）：
 *   "When I move, you may have another unit's base Might become 4 this turn."
 *
 * 规则依据（CR v1.5）：
 * - 383.1 / 421.1 / 449.1："When I move" 订阅 Move 事件（时点 object-moved，
 *   events/timing-points.ts 的 payloadFields 含 fromKind/fromLocationId/
 *   toKind/toLocationId）；458 明示 Recall 与入场不算 Move。
 * - "you may …" 是结算时的可选决定 → 契约 §3.9：choice.optional 把被选择的指令包在
 *   body 里，不写成 choice + linkedTo。
 * - 143.2.a / 143.2.a.1："base Might become 4" 改的是 Base Might（Trait-Altering
 *   图层里可被效果改写的特征），区别于「Might 变成 4」的算术图层写法；475/479.2 定义
 *   了图层顺序。
 * - "this turn" = end-of-turn 期限，由时点驱动的期限清理负责（契约 3.5）。
 * - "another unit" 排除来源自身（可用 ObjectFilter.exclude: "source" 表达，契约 3.6
 *   的锚点），且是选目标（355.9.b："unit you control" 一类限制的目标仍然选目标）。

 * status = judge-required（README 第 2 节）。两处缺口，均不近似实现：
 * 1. 没有已注册的「把 Base Might 设为 N（本回合）」原语：effects/instructions/ 里
 *    continuous.might 与 continuous.duration 都不存在（RIFT-91 layers-continuous
 *    未合入），effect.buff 的边界注释明确临时 Might 修改归 layers，不能拿 Buff
 *    计数器冒充；把 Base Might 当作有效 Might 处理也会改变 143.2.a 的三层语义
 *    （Trait-Altering 与 Arithmetic 不同层）。
 * 2. object-moved 时点没有发射方：事件管线的 action 适配器只为 move-location 动作
 *    生成该时点，而真实移动流程（Standard Move / zones-movement）尚未接入事件管线
 *    （同 ogn/traveling-merchant、ogn/miss-fortune-captain 的缺口记录）。
 * 下面保留有依据的形状：object-moved 自发触发 + choice.optional 包住一条
 * continuous.base-might 指令（含 target/exclude 与 this-turn 期限），执行部分由
 * golden 测试与 test.todo 记录。
 * 依赖：RIFT-91（layers-continuous，含 Trait-Altering 的 Base Might 设值与期限）、
 * 移动时点接线（批 5）。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "object-moved",
      filter: { event: "object-moved", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "lulu.may-set-base-might",
        op: "choice.optional",
        args: {
          prompt: {
            kind: "constant",
            value: "Have another unit's base Might become 4 this turn?"
          },
          body: {
            kind: "constant",
            value: [
              {
                // 143.2.a.1 / 475 / 479.2：Trait-Altering 图层的 Base Might 设值；
                // continuous.* 指令尚未注册（见 judgeReason 第 1 点），保留印刷语义。
                id: "lulu.set-base-might",
                op: "continuous.base-might",
                args: {
                  amount: { kind: "constant", value: 4 },
                  duration: { kind: "constant", value: "this-turn" },
                  target: { kind: "constant", value: "lulu.another-unit" }
                },
                targets: [
                  {
                    id: "lulu.another-unit",
                    // 「another unit」= 任意其他单位（不限定控制者），排除来源自身。
                    filter: { type: "unit", exclude: "source" },
                    min: 1,
                    max: 1,
                    selection: "one"
                  }
                ]
              }
            ]
          }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-4417983f70fa69947305b0884a1562186a0299bf7532c22d71f44111a3d79438",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不近似实现：(1) 缺少「把 Base Might 设为 N（本回合）」的原语——effects/instructions/ 没有 " +
    "continuous.might / continuous.duration（RIFT-91 layers-continuous 未合入），effect.buff 明确不含临时 Might 修改，" +
    "用 Buff 计数器或写成有效 Might 修改都会改变 143.2.a/475 的 Trait-Altering 与 Arithmetic 分层语义；" +
    "(2) object-moved 时点没有发射方：事件管线的 action 适配器只为 move-location 动作生成该时点，真实移动流程" +
    "（Standard Move / zones-movement）尚未接入（同 ogn/traveling-merchant 的缺口记录）。已写出的形状：" +
    "object-moved 自发触发 + choice.optional 包住 continuous.base-might 指令（target 排除 source、this-turn 期限）。" +
    "依赖：RIFT-91（layers-continuous 的 Base Might 设值与期限）、移动时点接线（批 5）。",
  abilities,
  sourceText: "When I move, you may have another unit's base Might become 4 this turn."
} satisfies CardProgram;

