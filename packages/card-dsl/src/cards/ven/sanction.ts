import type { CardProgram } from "../../ir/index.js";

/**
 * Sanction（ven-035-166）— Spell，3 能量 + 1 点 Calm 力量，领域 Calm，标签 无。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，ven-035-166，逐字）：
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)\nChoose one —\nEmpower a unit. Disempower it at end of turn.Disempower a unit that's [Empowered]. Empower it at end of turn."
 *
 * ⚠ 数据问题（不在本任务修改范围）：目录 sourceText 把两条模式挤成一行 —— 第一条模式结尾的
 * "at end of turn." 与第二条模式的 "Disempower a unit..." 之间没有换行或空格（"turn.Disempower"）。
 * 官方卡面是两条独立的 bullet；本程序按卡面把两条模式分别建模，sourceText 仍逐字使用目录原文
 * （见任务回复的数据问题清单）。
 *
 * 规则依据（Core Rules v1.5）：
 * - 「[Reaction]」是 813 的许可类关键词（813.1.c），卡文件只声明（展开归 keywords/Reaction.ts）。
 * - 「Choose one —」是 355.3 的 bulleted 模式列表：模式在 Finalize 决定，按契约 3.9 写成
 *   choice.mode（count 1、different true），不写成 choice + linkedTo。
 * - 442.1.a 规定 Empowered 是二元状态；442 / 443 把 Empower 与 Disempower 定义为受限动作
 *   （442.3/443.2：只有游戏效果指示时才能执行）。已合入的 effect.empower 原语正是该入口：
 *   objects 选择器 + mode（empower / disempower），并如实记录动作返回的结果。
 * - 「at end of turn」是两条模式各自的延迟到期动作（391.2 的 Delayed Ability：由结算中的法术
 *   创建、在指定的回合时点执行）。其内容分别是“Disempower 该单位”“Empower 该单位”；
 *   到期时点用封闭时点表的 turn-end（317.2/318 的结束步骤与清理）。
 * - 「a unit」/「a unit that's [Empowered]」由玩家在 Finalize 选择（355.5.a 的同类示例），
 *   所以是目标（355.7）；【Empowered】是 442.2/828.2 的状态特征，第二条模式以此限制目标合法性
 *   （355.9.b）。
 *
 * 当前状态与剩余接线见 judgeReason；不以原语存在代替整卡执行证据。
 */
export default {
  canonicalCardId: "card.hash-cc029bf96714e13a2e9bbc9f58b4d2a300a4d50e4257125afc218854ce4b3acf",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1)「Disempower it at end of turn」/「Empower it at end of turn」按 391.2 是该法术结算时创建的 Delayed Ability，" +
    "但 effects/instructions 没有卡牌可用的 trigger.delayed op 去调用 ResolveContext.registerDelayedTrigger（契约 3.6 只暴露接口；" +
    "同 ogn Imperial Decree / sfd Hostile Takeover 判定），写成卡自身 triggered 能力违反 391.1/393。" +
    "(2)「a unit that's [Empowered]」的目标限制不可表达：生产 ObjectSnapshot 不暴露 live empowered 计数，" +
    "因此 characteristics.empowered 只能失败闭合；442.1.b/443.1.a 的 effect.empower 动作本体已合入，程序不放宽为任意单位。" +
    "(3) 模式选择在结算期执行：生产打出链路在 programs/play.ts 的 validateSurface 对 choice.mode 直接 judge-required" +
    "（“Mode choices require a Finalize/Resolve choice-plan adapter”，同 rad/lost-to-the-sands），355.3 要求的 " +
    "Finalize 选择计划适配器未合入；解释器侧 choice.mode 本体已合入，golden 用 resolveChainBody + 参考内核 " +
    "setAnswers 真实执行两个模式分支。" +
    "已合入并真实执行：两条模式的 effect.empower 本体（442/443 的状态动作），golden 覆盖单原语与模式选择两个层级。" +
    "依赖：trigger.delayed 原语、Empowered 谓词与动作层语义、Finalize 选择计划适配器。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      // 印刷基础费用：3 能量 + 1 点 Calm 力量。
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 3 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          // 355.3 / 契约 3.9：二选一的模式列表（count 1、different true）。
          id: "sanction.choose-one",
          op: "choice.mode",
          args: {
            count: { kind: "constant", value: 1 },
            different: { kind: "constant", value: true },
            prompt: { kind: "constant", value: "Choose one —" },
            modes: {
              kind: "constant",
              value: [
                {
                  id: "sanction.empower-then-disempower",
                  body: [
                    {
                      // 「Empower a unit」：442 的 Empower 动作（受限动作，由本原语指示）。
                      id: "sanction.empower-unit",
                      op: "effect.empower",
                      args: {
                        objects: {
                          kind: "constant",
                          value: { kind: "target", id: "sanction.unit" }
                        },
                        mode: { kind: "constant", value: "empower" }
                      },
                      targets: [
                        {
                          id: "sanction.unit",
                          filter: { type: "unit", zone: "board" },
                          min: 1,
                          max: 1,
                          selection: "one"
                        }
                      ]
                    },
                    {
                      // 「Disempower it at end of turn」：延迟到 turn-end 的 Disempower（443.1）。
                      // op 未注册（见 judgeReason 第 1 条），不写成卡自身的触发能力。
                      // 该延迟能力由本法术创建（391.2），“it” 指同一张所选单位；此处不写 linkedTo：
                      // 442.1.c 规定对象已 Empowered 时 Empower 什么也不发生，而回合末的
                      // Disempower 仍按延迟能力照常执行，链接会把两者错误地绑成同一结果。
                      id: "sanction.delayed-disempower",
                      op: "trigger.delayed",
                      args: {
                        at: { kind: "constant", value: "turn-end" },
                        duration: { kind: "constant", value: "this-turn" },
                        body: {
                          kind: "constant",
                          value: [
                            {
                              id: "sanction.disempower-at-end",
                              op: "effect.empower",
                              args: {
                                objects: {
                                  kind: "constant",
                                  value: { kind: "target", id: "sanction.unit" }
                                },
                                mode: { kind: "constant", value: "disempower" }
                              }
                            }
                          ]
                        }
                      }
                    }
                  ]
                },
                {
                  id: "sanction.disempower-then-empower",
                  body: [
                    {
                      // 「Disempower a unit that's [Empowered]」：443 的 Disempower 动作；
                      // “that's [Empowered]” 是待接线的目标限制（见 judgeReason 第 2 条）。
                      id: "sanction.disempower-unit",
                      op: "effect.empower",
                      args: {
                        objects: {
                          kind: "constant",
                          value: { kind: "target", id: "sanction.empowered-unit" }
                        },
                        mode: { kind: "constant", value: "disempower" }
                      },
                      targets: [
                        {
                          id: "sanction.empowered-unit",
                          // characteristics.empowered 是待接线的状态特征；生产快照缺失时
                          // 匹配器失败闭合，绝不放宽为任意单位。
                          filter: { type: "unit", zone: "board", characteristics: { empowered: true } },
                          min: 1,
                          max: 1,
                          selection: "one"
                        }
                      ]
                    },
                    {
                      // 「Empower it at end of turn」：延迟到 turn-end 的 Empower（442）。op 未注册。
                      //同样：Disempower 是否实际移除状态不决定回合末的 Empower（443.1.a）。
                      id: "sanction.delayed-empower",
                      op: "trigger.delayed",
                      args: {
                        at: { kind: "constant", value: "turn-end" },
                        duration: { kind: "constant", value: "this-turn" },
                        body: {
                          kind: "constant",
                          value: [
                            {
                              id: "sanction.empower-at-end",
                              op: "effect.empower",
                              args: {
                                objects: {
                                  kind: "constant",
                                  value: { kind: "target", id: "sanction.empowered-unit" }
                                },
                                mode: { kind: "constant", value: "empower" }
                              }
                            }
                          ]
                        }
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
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Choose one —\n" +
    "Empower a unit. Disempower it at end of turn.Disempower a unit that's [Empowered]. Empower it at end of turn."
} satisfies CardProgram;
