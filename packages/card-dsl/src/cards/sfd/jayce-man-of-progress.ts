import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Jayce, Man of Progress (sfd-084-221) — Unit, Mind, Jayce/Piltover/Champion.
 * energy 4, power: none printed, Might 4.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-084-221，逐字）:
 *   "When you play me, you may kill a friendly gear. If you do, you may play a gear with Energy cost
 *   no more than :rb_energy_7: from hand this turn, ignoring its Energy cost. (You must still pay
 *   its Power cost.)"
 *
 * 规则依据（CR v1.5）:
 * - "When you play me"（383.4.a/420.4.a）：Play Effect，时点 card-played，{ source: "self" }。
 * - "you may kill a friendly gear"（403.1、契约 3.9）：被选指令包进 choice.optional 的 body；
 *   355.12 要求 may-action 的全部选择随该动作一并做出，因此 TargetSpec 挂在 choice.optional 节点上。
 *   "a friendly gear" 是 Board 上受本能力控制者控制的 gear（355.9.a.1、190.6.d），用
 *   controller: "self"（Finalize/query 包装归一化，同 sfd/guardian-of-the-passage 的注释）。
 *   消灭本体交给已合入的 effect.kill（429）。
 * - "If you do"（359.3.e.14.b）：直接引用前一条指令执行的游戏动作，需要动作回执。
 * - "you may play a gear ... from hand this turn, ignoring its Energy cost"：420.3 的效果式打出
 *   （355.10.a/420.3.c：手牌中的牌由玩家在结算时选择）；"ignoring its Energy cost" 按 356.1.b.2
 *   只把 Base Energy cost 置 0、Power 仍然照付（印刷提示 (You must still pay its Power cost.) 亦然）；
 *   "this turn" 是本回合一次性的后续打出许可（回合末到期的持续许可窗口）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required（复核 2026-10-17），四处依赖仍未合入，均不近似实现：
 * - 「If you do」需要前一条 kill 的动作回执（condition.result 类缺口），冻结 IR 无该绑定；
 *   不加恒真条件、也不把 kill 改写成费用。
 * - 「play a gear ... from hand this turn」是**本回合稍后**的一次性许可窗口：ObjectFilter 没有
 *   greatest/last-created 量词，TargetSpec 必须锁定 Finalize 时已存在的对象（355.5），手牌中的牌
 *   在触发结算时尚未由玩家选定；Duration 词汇（permanent/end-of-turn/end-of-combat/while-source-in-zone）
 *   也没有 one-shot「本回合的下一张」窗口（同 rad/firelights-hideout、ogn/raging-firebrand 的缺口）。
 * - 「ignoring its Energy cost」需要费用管线生成只把 Base Energy 置 0、保留 Power 的 finalized plan
 *   （356.1.b.2）：effect.play 只接受已 finalize 的计划、从不推导印刷费用；RIFT-257 的
 *   programs/play.ts translateCost 也对卡面的 cost 字段转 judge-required（discount/ignore 等键被拒），
 *   没有卡牌程序入口，而且计划必须在被选牌确定之后才能生成（RIFT-261 费用种类/费用计划批次）。
 * - 「a gear with Energy cost no more than :rb_energy_7:」需要印刷费用上限比较（206）：冻结 ObjectFilter
 *   没有费用谓词、已合入过滤器会静默忽略未知键（同 sfd/sandshifter、sfd/pickpocket 的缺口）。
 * effect.kill 与 choice.optional 已合入，golden 用锁定目标真实执行 kill 半段（接受/拒绝/目标失效），
 * 并用真实管道验证触发注册的形状。
 * 依赖：RIFT-261（费用种类与 ignore-cost 接线）、RIFT-90（印刷费用谓词与结果绑定）、
 * 一次性许可窗口（RIFT-91 后续）。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { event: "card-played", filter: { source: "self" } } },
    optional: false,
    body: [
      {
        id: "jayce.may-kill-friendly-gear",
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Kill a friendly gear?" },
          body: {
            kind: "constant",
            value: [
              {
                id: "jayce.kill-friendly-gear",
                op: "effect.kill",
                args: { target: { kind: "constant", value: "jayce.friendly-gear" } }
              },
              {
                // 「If you do, you may play a gear ...」：动作回执闸门与「本回合稍后的一次性打出许可」
                // 都未合入（见 judgeReason）；保留 420.3 的效果式打出形状与
                // 356.1.b.2 的「只忽略 Energy 费」费用计划形状。
                id: "jayce.may-play-gear-from-hand",
                op: "choice.optional",
                args: {
                  prompt: { kind: "constant", value: "Play a gear from your hand, ignoring its Energy cost?" },
                  body: {
                    kind: "constant",
                    value: [
                      {
                        id: "jayce.play-gear",
                        op: "effect.play",
                        args: {
                          // 手牌中的 gear 由玩家在本回合稍后打出时选择；静态 IR 无法枚举，
                          // 故用描述性 pick 形状保留意图（手牌是隐藏区域，355.10.a 的目标例外）。
                          pick: { kind: "constant", value: "jayce.gear-in-hand" },
                          cost: {
                            kind: "constant",
                            // 356.1.b.2：只把 base Energy 置 0，Power 照付；具体数值要等被选牌确定，
                            // 由费用管线生成（未合入，见 judgeReason）。
                            value: { finalized: true, energy: 0, power: ["printed"], xp: 0, ignoreEnergyOnly: true }
                          },
                          linkKey: { kind: "constant", value: "played" }
                        },
                        picks: [
                          {
                            id: "jayce.gear-in-hand",
                            options: ["runtime:gears-with-printed-energy-cost-at-most-7-in-controller-hand"],
                            selection: "one",
                            min: 1,
                            max: 1,
                            filter: {
                              zone: "hand",
                              type: "gear",
                              owner: "self",
                              costEnergyLte: 7
                            }
                          }
                        ]
                      }
                    ]
                  }
                }
              }
            ]
          }
        },
        targets: [
          {
            id: "jayce.friendly-gear",
            filter: { type: "gear", zone: "board", controller: "self" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-0b7c7cbc35b5094b62d279e16731c4fea82f84054ddee4bfee7ba32cf3791d92",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "四处依赖仍未合入，均不近似实现：(1)「If you do」是 359.3.e.14.b 的直接引用游戏动作条件（调研记为 condition.result）：冻结 IR 没有动作回执绑定，" +
    "后续打出指令无法按 kill 实际发生开闸；不加恒真条件，也不把 kill 改写成费用。" +
    "(2)「play a gear with Energy cost no more than :rb_energy_7: from hand this turn」需要 206 的印刷费用上限比较（冻结 ObjectFilter 无费用谓词，未知键被静默忽略，同 sfd/sandshifter），" +
    "以及「本回合稍后」的一次性许可窗口：ObjectFilter 没有 greatest/last-created 量词，TargetSpec 必须锁定 Finalize 时已存在的对象（355.5），Duration 也没有 one-shot「本回合的下一张」期限（同 rad/firelights-hideout 的缺口）。" +
    "(3)「ignoring its Energy cost」按 356.1.b.2 只把 Base Energy 置 0、Power 照付（印刷提示亦然）：effect.play 只接受已 finalize 的计划、从不推导印刷费用，" +
    "RIFT-257 的 translateCost 对卡面 cost 字段直接转 judge-required、cost/ 也没有 ignore-base 的卡牌程序入口，且计划必须在被选牌确定后才生成（RIFT-261）。" +
    "effect.kill 与 choice.optional 已合入，golden 用锁定目标真实执行 kill 半段（接受/拒绝/目标失效三分支）。" +
    "依赖：RIFT-261（费用种类与 ignore-cost）、RIFT-90（印刷费用谓词与结果绑定）、一次性许可窗口（RIFT-91 后续）。",
  abilities,
  sourceText:
    "When you play me, you may kill a friendly gear. If you do, you may play a gear with Energy cost no more than :rb_energy_7: from hand this turn, ignoring its Energy cost. (You must still pay its Power cost.)"
} satisfies CardProgram;

export default program;
