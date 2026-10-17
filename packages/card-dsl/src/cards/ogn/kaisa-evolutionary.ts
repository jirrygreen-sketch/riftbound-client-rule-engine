import type { CardProgram } from "../../ir/index.js";

/**
 * Kai'Sa, Evolutionary (ogn-112-298), CR v1.5 810 / 355.10.a / 356.1.b.2.
 * programs/ keyword/static/trigger binding and cost.pay/cost.modify are merged.
 * Remaining boundaries: Energy < controller points at target selection
 * (RIFT-359); the actually selected spell's printed cost must feed an
 * ignore-base-energy cost plan through nested Finalize; effect.play links a
 * count, not the played card's post-resolution reference for "Then recycle it".
 * Ganking registers a movement rule, but its string permission must be
 * normalized to permission.routes for the movement-rule query/consumer. Retained play cost/playedObjects describe blocked
 * bindings and must not be treated as a complete executable cost plan.
 */
const kaisaEvolutionary = {
  canonicalCardId: "card.hash-697cf91efe23c8a9d145276f047432baac8d3218d9975045d3e27ad7573275ec",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺：(1) 选牌时比较候选法术 Energy 与控制者 points 的动态过滤（RIFT-359）；" +
    "(2) 对实际选中法术生成 ignore-base-energy、保留 Power 的费用计划并接入嵌套打出的 Finalize（CR 356.1.b.2）；" +
    "cost.modify/cost.pay 已合入，但 effect.play 的 cost 需要完整 finalized 计划，当前静态占位计划未绑定所选牌的 Power；" +
    "(3) effect.play 仅链接 played 次数，缺打出、结算后供 Then recycle it 使用的当前对象引用与后续结算时序；" +
    "(4) Ganking 展开用字符串 permission=battlefield-to-battlefield，movement 规则查询要求 permission.routes 数组；缺两种已合入形状的适配（810.1.b）。",
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
