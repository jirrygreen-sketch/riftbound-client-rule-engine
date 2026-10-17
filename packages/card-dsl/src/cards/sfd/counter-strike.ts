import type { CardProgram } from "../../ir/index.js";

/**
 * Counter Strike (sfd-194-221) — Spell, 2 energy + 1 Calm/Body power,
 * Calm/Body, tags Jax/Signature.
 *
 * Printed text:
 *   [Reaction] (Play any time, even before spells and abilities resolve.)
 *   Choose a unit. The next time that unit would be dealt damage this turn,
 *   prevent it. Draw 1.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Reaction] (813) is declared as a keyword ability; the closed-state
 *   permission is expanded by effects/keywords/Reaction.ts.
 * - "Choose a unit" is a target, not a pick: 355.10.c gives the exact example
 *   ("Choose a friendly unit. The next time it would die this turn, return it
 *   to your hand instead" targets a friendly unit, because "choose a friendly
 *   unit" is not part of the replacement effect). The unit is therefore
 *   declared as a TargetSpec on the instruction that creates the shield.
 * - "The next time that unit would be dealt damage this turn, prevent it" is
 *   a one-shot prevention replacement effect (367-371; 371.1 counts the
 *   "next time" window, and 467.2.c.10 uses this card as its example of a
 *   replacement effect that still leaves the unit able to be dealt damage).
 *   The merged replacement binder (RIFT-260) has no form for this: it
 *   supports static replacements plus replacement.event over the closed
 *   GameAction set, but replacement.prevent is not a supported opcode
 *   (BlockedReplacementError at bind time), and replacement.event anchors on
 *   a player or an action-carried object filter — the replaced damage event's
 *   object is the damage target, not a plan-time binding the card can name,
 *   so "that unit" (the unit locked by this spell's TargetSpec) cannot be
 *   written as a re-playable subscription.
 * - "Draw 1." is a second, independent instruction (158.1) and stays
 *   unlinked: 359.3.e.11 keeps the draw when the shield cannot be created.
 *
 * Status: judge-required. The target declaration, the duration and the
 * one-shot lifetime are described; the prevention half is not approximated
 * (no replacement.prevent op, no target-anchored one-shot damage replacement),
 * and the draw half is executed by the golden test.
 */
const counterStrike = {
  canonicalCardId: "card.hash-c6634bd393cadc3a20eda81ee688c8d171d215f7dd6297a92a55a2491f3ec43a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺针对单个目标单位的一次性防伤替代形态：「The next time that unit would be dealt damage this turn, prevent it」是 CR v1.5 367-371 的" +
    "一次性预防替代（371.1 的一次计数窗口，467.2.c.10 正是本卡的例子）；已合入的替代绑定（RIFT-260）没有防伤形态——" +
    "replacement.prevent 不在支持的 opcode 列表内（绑定时抛 BlockedReplacementError），replacement.event 只能按玩家或动作自带对象过滤锚定，" +
    "无法把「被打的是本卡 Finalize 锁定的那个目标」写成可重放的替换订阅；契约 3.6 的封闭 GameAction 集合也没有 prevent 动作，" +
    "替代必须在动作执行前拦截，而 ResolveContext 的结算期注册通道只有 addContinuous / registerDelayedTrigger，没有 registerReplacement，" +
    "卡牌正文无法在结算时建立这个盾，不近似实现。" +
    "依赖：针对被锁定目标的伤害预防替代（replacement.prevent 或等价的 replacement.event 目标绑定，替代批次后续）。" +
    "「Choose a unit」按 355.10.c 的例子是目标选择，" +
    "「Draw 1」是独立的 effect.draw，两者都已在程序中表达并在金标测试中覆盖。",
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Choose a unit. The next time that unit would be dealt damage this turn, prevent it. Draw 1.",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          // "The next time that unit would be dealt damage this turn,
          // prevent it" — a one-shot prevention replacement effect. No
          // merged primitive creates it; the target is the chosen unit
          // (355.10.c), declared on this instruction the same way 355.8
          // locks targets as the spell is put on the chain.
          id: "counter-strike.prevent",
          op: "replacement.prevent",
          args: {
            event: { kind: "constant", value: "damage" },
            scope: { kind: "constant", value: "one-shot-this-turn" },
            amount: { kind: "constant", value: "all" }
          },
          targets: [
            {
              id: "counter-strike.unit",
              filter: { type: "unit" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "Draw 1." — independent of the shield (359.3.e.11).
          id: "counter-strike.draw",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default counterStrike;
