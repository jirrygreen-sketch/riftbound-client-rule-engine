import type { CardProgram } from "../../ir/index.js";

/**
 * Kai'Sa, Evolutionary (ogn-112-298), CR v1.5 355.10.a / 356.1.b.2 / 810.
 * 当前复核：费用规划器可只忽略 Energy 并保留 Power；整卡仍缺动态目标比较、
 * 嵌套打出的目标/费用生命周期、打出对象引用，以及 Ganking 的许可适配。
 */
const kaisaEvolutionary = {
  canonicalCardId: "card.hash-697cf91efe23c8a9d145276f047432baac8d3218d9975045d3e27ad7573275ec",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺四条接线：(1) 候选法术印刷 Energy < 控制者当前 points 的动态目标比较（355.10.a）；" +
    "programs/filters.ts 拒绝 energyLessThan，现有事件/结果谓词不能比较候选与玩家分数。" +
    "(2) choice.optional 内的目标须接入嵌套 Finalize，并按实际选牌生成 ignore-base-energy 费用计划，" +
    "保留印刷 Power 与后续附加费用（356.1.b.2/.3）；当前 { finalized: true, energy: 0 } 常量未携带 Power。" +
    "(3) Then recycle it 需要打出对象的当前引用及结算顺序；effect.play 只链接 played 次数，playedObjects 无生产者。" +
    "(4) Ganking 的 continuous.movement 字符串 permission 未适配 movement 查询所读的 permission.routes（810.1.b）。",
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
