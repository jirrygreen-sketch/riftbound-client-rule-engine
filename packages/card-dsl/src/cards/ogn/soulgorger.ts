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
 *   （原文括注 “You must still pay its Power cost.”）。
 * - 381 / 420.3.b：打出位置仍走正常流程（默认控制者的 Base）。
 *
 * status 判定（README 第 2 节）：judge-required。2026-10-17 复核后的当前真实缺口
 * （均已实测，不近似实现）：
 * 1. choice.optional 体内的指令带 targets，而链的 Finalize 面拒绝嵌套目标：
 *    chain/engine.ts 的 assertFinalizationSurface 抛出 ChainContractBlockedError
 *    “Nested/repeated targets require an interpreter target-selection lifecycle adapter”。
 *    实测以 executable 形态挂到 ChainEngine 后，card-played 触发入链，Finalize 直接抛错
 *    （接受与拒绝 may-clause 都抛），因此“选择一张 Trash 单位”这一步在生产路径上无法完成，
 *    需要指令内目标的 Finalize/Resolve 选择生命周期。
 * 2. 无法为被选中的那张牌生成“忽略 Energy、保留 Power”的 finalized 计划：instructions/
 *    里没有读取对象印刷费用的指令（instruction registry 中不存在 cost.printed），
 *    cost.modify 只能消费调用方已经提供的印刷目录投影（printed 参数），不能从 Finalize
 *    锁定的 Trash 对象动态取得印刷费用；effect.play 明确只接受已 finalize 的计划，
 *    自身不实现 ignore-cost 规则。缺「锁定对象 → 印刷费用 → 计划 → 打出」的接线。
 *
 * 已合入且由 golden 真实执行的部分：可选包装的接受/拒绝（choice.optional）、
 * effect.play 的执行路径（含 stale 目标 / 被替代边界），以及 cost.modify 对调用方提供的
 * 印刷投影生成 ignore-base(energy) 计划（356.1.b.2 / 356.6）。
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
    "两处当前缺口（复核 2026-10-17，均已实测）：(1)「选择一张 Trash 单位」是 choice.optional 体内的" +
    "指令目标，而链的 Finalize 面拒绝嵌套目标——chain/engine.ts 的 assertFinalizationSurface 抛 " +
    "ChainContractBlockedError「Nested/repeated targets require an interpreter target-selection lifecycle adapter」；" +
    "实测以 executable 形态挂在 ChainEngine 上时，card-played 触发入链后 Finalize 直接抛错（接受与拒绝 " +
    "may-clause 都抛），因此该目标无法在生产路径完成，需指令内目标的 Finalize/Resolve 选择生命周期。" +
    "(2)「ignoring its Energy cost」（356.1.b.2：Base Energy 置 0、Power 照付）需要按被锁定的 Trash 对象" +
    "动态生成 finalized 费用计划：instruction registry 中不存在读取对象印刷费用的指令（无 cost.printed——" +
    "本程序里的 cost.printed 是待合入的声明），cost.modify 只能消费调用方提供的印刷目录投影（printed 参数），" +
    "effect.play 只接受已 finalize 的计划、自身不实现 ignore-cost 规则；缺「锁定对象 → 印刷费用 → 计划 → 打出」的接线。" +
    "已合入并由 golden 真实执行：choice.optional 的接受/拒绝、effect.play 的执行（含 stale / replaced 边界）、" +
    "以及 cost.modify 对调用方提供的印刷投影生成 ignore-base(energy) 计划。不近似实现。",
  abilities,
  sourceText:
    "When you play me, you may play a unit from your trash, ignoring its Energy cost. " +
    "(You must still pay its Power cost.)"
} satisfies CardProgram;

export default program;
