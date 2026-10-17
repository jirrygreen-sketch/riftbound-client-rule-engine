import type { CardProgram } from "../../ir/index.js";

/**
 * Frigid Touch — sfd-066-221 (Spell, Mind, Rumble SFD champion precon).
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   [Repeat] [2] (You may pay the additional cost to repeat this spell's effect.)
 *   Give a unit -2 [M] this turn.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is a keyword ability expanded by the keyword registry.
 * - [Repeat] [2] (820) is an Optional Additional Cost keyword: 820.1.d makes
 *   the paid instance execute the spell's instructions one additional time
 *   during resolution, with choices re-made (820.2 / 820.2.a). The 2-energy
 *   optional additional cost is declared on the play CostSpec (contract 3.1);
 *   the extra executions stay represented by an effect.repeat node whose
 *   count must come from the paid-instance receipt (820.1.c.1), never as a
 *   fixed count written into the card.
 * - "Give a unit -2 [M] this turn" is a temporary Might modification executed
 *   by the merged continuous.might primitive (RIFT-258): contract 3.4's
 *   arithmetic layer, end-of-turn duration, and the printed wording's use of
 *   the same TargetSpec for a re-made choice (820.2.a).
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，两处当前缺口：
 * - [Repeat] 的收费与计数仍无已合入路径：Repeat KeywordDef（RIFT-86/
 *   effects/keywords/Repeat.ts）只声明 repeat.cost 静态能力，Finalize 费用计划从不读取它，
 *   effects/instructions/ 下没有已注册的 cost.pay / cost.additional 原语
 *   （RIFT-261 费用种类批次未合入 HEAD），也没有消费方把已付费实例数接到解释器的
 *   repeat 节点。程序因此不把 count 写成固定 1（会近似成未付费也重复）。
 * - effect.repeat 的闭集动作里没有 Might 修改动作：契约 3.6 的 GameAction 集合无 might
 *   动作，用 buff 动作代替会把 -2 Might 写成 Buff counter（702/703），属禁止的近似。
 * 已合入并真实执行：Reaction 关键词声明、continuous.might 的临时 -2 Might 注册与
 * 回合末到期（golden 经生产链适配器执行，含目标失效 ignored）。
 */
const frigidTouch = {
  canonicalCardId: "card.hash-153eb4df721b70662a63652ba1602985ceed08d81a0b23fc0d6b10349ee15ca9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口：(1)「[Repeat] :rb_energy_2:」（820.1.c.1）的收费与计数没有已合入路径——Repeat KeywordDef" +
    "（RIFT-86）只输出 repeat.cost 静态能力，Finalize 费用计划从不读取它，effects/instructions/ 也没有已注册的 " +
    "cost.pay / cost.additional 原语（RIFT-261 批次未合入 HEAD），已付费实例数到解释器 repeat 节点的接线同样缺失；" +
    "本卡不把 count 写成固定 1。(2) effect.repeat 的闭集动作集合（契约 3.6）没有 Might 修改动作，" +
    "用 buff 动作重复会把 -2 Might 变成 Buff counter（702/703），属禁止的近似。" +
    "「Give a unit -2 :rb_might: this turn」半段已可执行：continuous.might（RIFT-258）注册 arithmetic 层修正、" +
    "回合末到期，golden 已用生产链适配器真实执行（含目标失效 ignored）。依赖：RIFT-261 与 repeat 付费计数接线。",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        kind: "additional",
        payments: [
          {
            kind: "energy",
            amount: { kind: "constant", value: 2 },
            choice: {
              id: "repeat-payment",
              options: ["pay", "decline"],
              selection: "one"
            }
          }
        ]
      },
      body: [
        {
          id: "give-minus-2-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: -2 },
            duration: { kind: "constant", value: "this-turn" },
            // 契约 3.6：作用对象经 objects 描述符指向 Finalize 锁定的 TargetSpec；
            // 生产链适配器按该描述符读取 ctx.targets，重选目标（820.2.a）由 repeat 承担。
            objects: {
              kind: "constant",
              value: { kind: "target", id: "affected-unit" }
            }
          },
          targets: [
            {
              id: "affected-unit",
              filter: { types: "unit" },
              selection: "one"
            }
          ]
        },
        {
          id: "repeat-effect",
          op: "effect.repeat",
          args: {
            count: { kind: "constant", value: 1 },
            actions: {
              kind: "constant",
              value: [
                {
                  type: "buff",
                  values: { amount: { kind: "constant", value: -2 } },
                  targets: { object: "affected-unit" }
                }
              ]
            }
          },
          linkedTo: "give-minus-2-might"
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
    "Give a unit -2 :rb_might: this turn."
} satisfies CardProgram;

export default frigidTouch;
