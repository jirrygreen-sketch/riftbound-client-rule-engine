import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Lulu, Whimsical (rad-110-167) — Unit, 3 Energy, Might 3, Chaos,
 * tags Yordle/Bandle City/Lulu/Champion。
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
 *
 * status = judge-required（README 第 2 节）。2026-10-17 复核后的当前缺口，均不近似实现：
 * 1. 「把 Base Might 设为 N（本回合）」仍无原语。已合入的 continuous.might
 *    （RIFT-258）只注册 arithmetic 层的 add / set-might（effects/instructions/
 *    continuous.might.ts → layers/ops/index.ts buildMightSpec → layers/engine.ts
 *    applyArithmetic，479.4），那是「Increase its Might to 5」的写法；143.2.a.1 的
 *    「Its base Might becomes 4」落在 479.2 Trait-Altering 图层，registry 里没有
 *    continuous.base-might / trait 设值指令，也没有对应的图层消费者。effect.buff（702）
 *    只处理 Buff 计数，不能冒充 Might 特征修改。
 * 2. 「When I move」仍不能执行：object-moved 已有时点产生方（events/action-adapter.ts
 *    把 move-location 映射为该时点，docs/rules/timing-point-producers.md 第 66 行记录），
 *    但真实 Move 流程未实现——combat/flow.ts 的 move() 明确抛 standard-move-transaction
 *    （Standard Move 需要 Exhaust + Move 的原子事务，CR 144.2），且没有已合入路径把
 *    卡牌程序的触发注册进事件管线（RIFT-257）。
 * 下面保留有依据的形状：object-moved 自发触发 + choice.optional 包住一条
 * continuous.base-might 指令（含 target/exclude 与 this-turn 期限）；可选拒绝路径由
 * golden 真实执行，缺原语的部分由 test.todo 记录。
 * 依赖：Trait-Altering 的 Base Might 设值原语（RIFT-91 后续）、卡牌程序触发注册
 * （RIFT-257）、真实 Move 事务（批次 5）。
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
                // 该指令尚未注册（见 judgeReason 第 1 点），保留印刷语义。
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
    "两处缺口，均不近似实现：(1) 缺少「把 Base Might 设为 N（本回合）」的原语：已合入的 continuous.might（RIFT-258）" +
    "只注册 arithmetic 层的 add / set-might（buildMightSpec → layers/engine.ts applyArithmetic，479.4），" +
    "而 143.2.a.1 / 475 / 479.2 的 \"its base Might becomes 4\" 落在 Trait-Altering 图层，" +
    "effects/instructions/ 没有对应的 continuous.base-might / trait 设值指令与图层消费者（RIFT-91 后续）；" +
    "把 Base Might 当作有效 Might 写会改变 143.2.a 的三层语义，effect.buff 只处理 702 的 Buff 计数。" +
    "(2) 「When I move」仍不能执行：object-moved 的时点产生方已合入（events/action-adapter.ts 把 move-location " +
    "映射为该时点，docs/rules/timing-point-producers.md 已记录），但真实 Move 流程未实现" +
    "（combat/flow.ts move() 抛 standard-move-transaction，Standard Move 需要 Exhaust + Move 的原子事务），" +
    "且没有已合入路径把卡牌程序的触发注册进事件管线（RIFT-257）。" +
    "已写出的形状：object-moved 自发触发 + choice.optional 包住 continuous.base-might 指令（target 排除 source、this-turn 期限）；" +
    "可选拒绝路径有真实执行证据。依赖：Base Might 设值原语（RIFT-91 后续）、卡牌程序触发注册（RIFT-257）、真实 Move 事务。",
  abilities,
  sourceText: "When I move, you may have another unit's base Might become 4 this turn."
} satisfies CardProgram;
