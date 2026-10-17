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
 *   a one-shot prevention replacement effect (369.2; 392 limits its delayed
 *   window, and 467.2.c.10 uses this card as its example of a
 *   replacement effect that still leaves the unit able to be dealt damage).
 *   replacement.prevent now installs that window through EventPipeline and
 *   accepts a Finalize target selector. The production interpreter does not
 *   forward its required ResolveContext.replacement runtime extension. Its
 *   target filter also captures only objectId, not zoneEntryId, so it cannot
 *   yet distinguish a new incarnation of a unit that left and returned.
 * - "Draw 1." is a second, independent instruction (158.1) and stays
 *   unlinked: 359.3.e.11 keeps the draw when the shield cannot be created.
 *
 * Status: judge-required. The target declaration, the duration and the
 * one-shot lifetime are described; the merged prevention primitive and draw
 * have execution evidence, but the missing production wiring and incarnation
 * tracking keep the full card judge-required.
 */
const counterStrike = {
  canonicalCardId: "card.hash-c6634bd393cadc3a20eda81ee688c8d171d215f7dd6297a92a55a2491f3ec43a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "replacement.prevent 原语已合入，支持绑定 Finalize 目标、amount: all 与 one-shot-this-turn，" +
    "并通过 EventPipeline 真正预防第一次匹配伤害（CR v1.5 369.2/392/467.2.c.10）。仍缺：(1) 生产结算接线：" +
    "ResolveContext.replacement（host + pipeline）仅是原语的运行时扩展，effects/interpreter.ts 的 instructionContext " +
    "不转发该扩展，原始 play body 经 resolveChainBody 执行仍抛 BlockedReplacementError；需共享契约及解释器/链适配。" +
    "(2) 目标身份：原语将 TargetSpec 解析成 objectId 筛选，未保留 zoneEntryId，不能满足非 Board 区域变更产生新对象的 124。" +
    "依赖：替代注册上下文的生产接线与目标入区身份锁定；不近似实现。「Choose a unit」按 355.10.c 是目标，" +
    "「Draw 1」为独立 effect.draw，原语执行及失效目标不阻止抽牌均有测试。",
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
          // prevent it" — the merged primitive must explicitly bind the
          // chosen unit (355.10.c); omitting target would shield all units.
          // Production context and incarnation tracking remain blocked.
          id: "counter-strike.prevent",
          op: "replacement.prevent",
          args: {
            event: { kind: "constant", value: "damage" },
            scope: { kind: "constant", value: "one-shot-this-turn" },
            amount: { kind: "constant", value: "all" },
            target: { kind: "constant", value: { target: "counter-strike.unit" } }
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
