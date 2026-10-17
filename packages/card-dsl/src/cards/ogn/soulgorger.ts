import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Soulgorger (ogn-196-298) — Unit, 8 energy + 2 Chaos power, 5 Might.
 *
 * Printed text:
 *   When you play me, you may play a unit from your trash, ignoring its Energy
 *   cost. (You must still pay its Power cost.)
 *
 * 规则依据（CR v1.5）：
 * - “When you play me” 是 Play Effect（383.4.a.1 / 383.4.a.2），时点 card-played。
 * - “you may play a unit from your trash”：355.1（选择在 Finalize 前做出），420.3（游戏效果
 *   指示的 Play 是 Limited Action，420.3.a：不需要额外许可）。
 * - “a unit from your trash” 是被指名区域里的对象：355.9.a.1 + 355.9.a 的示例
 *   (“Recycle a unit from your trash” targets a unit card in your trash)，所以是**目标**
 *   （355.10.a 的“非公开区域”例外不成立——108.2.d 规定 Trash 是公开信息）。
 * - “ignoring its Energy cost”：356.1.b.2——把该牌的 Base Energy 设为 0，Power 仍然照付
 *   （原文括注 “You must still pay its Power cost.”）。本程序把这一点写成
 *   `effect.play` 的 `cost` 参数形状，来源是 `cost.printed`（需要读被选择牌的印刷费用
 *   并按 `ignore: "energy"` 生成计划）。
 * - 381 / 420.3.b：打出位置仍走正常流程（默认控制者的 Base）。
 *
 * status 判定（README 第 2 节）：judge-required。`cost.printed` 仍不是已注册的
 * instruction，`cost.modify` 只能从调用方提供的 printed catalog projection 建计划，
 * 不能从本卡锁定的 Trash 对象动态读取其印刷费用；因此无法生成“忽略 Energy、保留
 * Power”的 finalized cost plan。`effect.play` 仍只接受调用方给出的计划，并只链接成功
 * 次数，没有把被打出的对象或动态计划作为后续可消费的结果。
 * golden 测试真实执行两半：可选包装的接受/拒绝（choice.optional + effect.play 的
 * 调用方计划），以及“stale 目标 / 被替代”两个边界。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        // “you may play …”：接受与否是玩家的选择（355.1），按契约 3.9 把被选指令包进 body。
        id: "soulgorger.may-play",
        op: "choice.optional",
        args: {
          prompt: {
            kind: "constant",
            value: "Play a unit from your trash, ignoring its Energy cost?"
          },
          body: {
            kind: "constant",
            value: [
              {
                id: "soulgorger.printed-cost",
                op: "cost.printed",
                args: {
                  card: {
                    kind: "object-property",
                    object: { target: "unit-card-in-trash" },
                    property: "cardId"
                  },
                  // 356.1.b.2：只忽略 Energy；Power 仍然要付。
                  ignore: { kind: "constant", value: "energy" },
                  linkKey: { kind: "constant", value: "plan" }
                },
                targets: [
                  {
                    id: "unit-card-in-trash",
                    filter: { type: "unit", zone: "trash", owner: "self" },
                    min: 1,
                    max: 1,
                    selection: "one"
                  }
                ]
              },
              {
                id: "soulgorger.play",
                op: "effect.play",
                linkedTo: "soulgorger.printed-cost",
                args: {
                  object: {
                    kind: "object-property",
                    object: { target: "unit-card-in-trash" },
                    property: "ref"
                  },
                  cost: {
                    kind: "linked-value",
                    instructionId: "soulgorger.printed-cost",
                    key: "plan"
                  },
                  location: { kind: "constant", value: { type: "base", player: "self" } },
                  linkKey: { kind: "constant", value: "playedUnit" }
                },
                targets: [
                  {
                    id: "unit-card-in-trash",
                    filter: { type: "unit", zone: "trash", owner: "self" },
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

const program = {
  canonicalCardId: "card.hash-ad456571717d54ed1ac0fa819ef9e14432c36a2fb8c86e3fa5e2c95ac4a7c25f",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺 cost.printed 原语：effects/instructions/ 没有该文件，无法读取被选中 Trash 单位的印刷费用并按 " +
    "356.1.b.2 生成“忽略 Energy、保留 Power”的 finalized cost plan；effect.play 虽然已合入，" +
    "但它只接受调用方给出的 FinalizedCostPlan，本身不实现忽略费用规则，两者之间的动态接线也不存在。" +
    "当前 cost.modify/cost.pay 只消费调用方已有的费用计划，不能从锁定卡牌的印刷目录投影生成该计划；" +
    "effect.play 也只接受 finalized 计划并链接成功次数，缺少计划与被打出对象的结果接线。" +
    "可选的 choice.optional 包装与 effect.play 的执行路径已合入，golden 测试真实执行接受/拒绝与 stale / replaced 边界。",
  abilities,
  sourceText:
    "When you play me, you may play a unit from your trash, ignoring its Energy cost. " +
    "(You must still pay its Power cost.)"
} satisfies CardProgram;

export default program;
