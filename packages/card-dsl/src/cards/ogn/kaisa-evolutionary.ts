import type { CardProgram } from "../../ir/index.js";

/**
 * Kai'Sa, Evolutionary (ogn-112-298), CR v1.5 355.10.a / 356.1.b.2 / 810.
 * 当前复核（2026-10-17）：费用规划器可只忽略 Energy 并保留 Power（golden 覆盖）；
 * 整卡仍缺触发注册的事件名词汇（conquer → conquered）、动态目标比较（energyLessThan）、
 * 嵌套打出的目标/费用生命周期、打出对象引用，以及 Ganking 的许可适配。
 */
const kaisaEvolutionary = {
  canonicalCardId: "card.hash-697cf91efe23c8a9d145276f047432baac8d3218d9975045d3e27ad7573275ec",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处已实测的当前缺口：(1) 触发注册先失败在事件名的封闭拼写上：本卡 filter 的 event: \"conquer\" 经 " +
    "translateTriggerFilter 保留后由 validateTriggerSpec 拒绝（触发词表只有 \"conquered\"），" +
    "registerProgramTriggers 实测抛 TriggerSpecValidationError/invalid-event-type（471.1 / 473.2.a）。" +
    "(2) 候选法术印刷 Energy < 控制者当前 points 的动态目标比较（355.10.a）没有生产词汇：" +
    "programs/filters.ts 的 translateObjectFilter 拒绝 energyLessThan，现有事件/结果谓词只处理" +
    "played-from/printed-characteristic/result，不能比较候选牌与玩家分数。" +
    "(3) choice.optional 内的目标须接入嵌套 Finalize，并按实际选牌生成 ignore-base-energy 费用计划，保留印刷 Power 与" +
    "后续附加费用（356.1.b.2/.3）；cost.modify/buildCostPlan 已能由调用方给定选牌后生成该计划（golden 覆盖），" +
    "但把该计划绑定到卡内指令的生产生产者仍缺：当前 IR 的 { finalized: true, energy: 0 } 常量不携带 Power。" +
    "(4) Then recycle it 需要打出对象的当前引用；effect.play 只链接 played 次数，playedObjects 无生产者。" +
    "另：Ganking 展开的 continuous.movement 字符串 permission 与 movement 查询所读的 permission.routes 仍不一致" +
    "（layers/rules/query.ts 只读 routes；实测 canGank=false），依赖该路由适配（810.1.b）。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "ganking" },
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        filter: { event: "conquer", filter: { role: "self" } }
      },
      optional: false,
      body: [
        {
          id: "kaisa.opt-in",
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Play a spell from your trash without paying its Energy cost?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "kaisa.play-spell",
                  op: "effect.play",
                  args: {
                    // 355.10.a / 355.10.a.1：Trash 是公开区域 → 使用 targets 选目标。
                    target: { kind: "constant", value: "kaisa.trash-spell" },
                    // 356.1.b.2：只忽略 Energy（base Energy cost 置 0），Power 仍须按被
                    // 选牌的印刷费用支付 —— 后者只有结算时才知道，静态 IR 生成不出可支付
                    // 的 finalized 计划，因此这里的计划只是形状（本卡 judge-required，
                    // 所选牌费用绑定补齐前不得当作可执行费用）。
                    cost: { kind: "constant", value: { finalized: true, energy: 0 } }
                  },
                  targets: [
                    {
                      id: "kaisa.trash-spell",
                      filter: {
                        zone: "trash",
                        owner: "controller",
                        type: "spell",
                        // 动态条件：「Energy cost less than your points」需要
                        // Finalize 期的跨对象数值比较，保留占位形状。
                        energyLessThan: "controller-points"
                      },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                },
                {
                  id: "kaisa.recycle-it",
                  op: "effect.recycle",
                  linkedTo: "kaisa.play-spell",
                  args: {
                    // “Then recycle it” 指刚打出的那张牌；effect.play 目前只链接
                    // 成功次数，缺少对象引用绑定（见 judgeReason）。
                    objects: {
                      kind: "linked-value",
                      instructionId: "kaisa.play-spell",
                      key: "playedObjects"
                    }
                  }
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Ganking] (I can move from battlefield to battlefield.)\n" +
    "When I conquer, you may play a spell from your trash with Energy cost less than your points without paying its Energy cost. Then recycle it. (You must still pay its Power cost.)"
} satisfies CardProgram;

export default kaisaEvolutionary;
