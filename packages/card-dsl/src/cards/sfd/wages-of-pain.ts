import type { CardProgram } from "../../ir/index.js";

/**
 * Wages of Pain — sfd-070-221 (CR v1.5 811.1, 187.5, 184.1).
 *
 * Status: judge-required (cards/README.md §2), re-verified 2026-10-18 against the
 * merged engine sources. The measured current gaps are unchanged in kind:
 * - CR 187.5 Gold is still absent from effect.token's frozen DEFINITIONS table,
 *   which documents that definitions carrying their own abilities (including
 *   Gold) stay blocked. The merged primitive returns negated with
 *   blockedReason "token-definition-or-abilities-judge-required", and the
 *   intrinsic "[Reaction][>] Kill this, [E]: [Add] [A]" ability has no contract
 *   representation either: [A] is universal Power while the six-domain closed
 *   Domain set cannot express a domainless resource (sfd/gold.ts records the
 *   same gap). A plain ability-less Gear is not a substitute.
 * - CR 184.1 / 185.2.d: the "exhausted" entry stipulation is still unsupported.
 *   effect.token's ARGUMENTS set has no `entersExhausted`, so the authored
 *   argument throws "Invalid effect.token argument: entersExhausted"; the
 *   create-token action documents "Entry overrides are not supported", and a
 *   later exhaust is not equivalent (143.4).
 * - Hidden (811.1.b/.d.2) still has no play path: the keyword expands to a
 *   static cost.hidden that the default binder rejects ("Static ability kind
 *   cost.hidden has no layer mapping"), and there is no Hide action, facedown
 *   zone, next-turn free Reaction play, or original-battlefield target
 *   restriction consumer.
 * The damage half really executes (effect.damage), including the ignored
 * mistargeted boundary; that evidence stays in the golden.
 */
const wagesOfPain = {
  canonicalCardId: "card.hash-431738fdce44471075e7d0f77a009dde71d56c7be7e2c9ef022d6b124a857a3c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处当前缺口（2026-10-18 复核实测；不近似实现）：(1) CR 187.5 的 Gold 仍不在 effect.token 的 frozen DEFINITIONS 表，实测 \"gold\" 走原语返回 negated 且 blockedReason \"token-definition-or-abilities-judge-required\"；" +
    "内建 [Reaction][>] Kill this, [E]: [Add] [A] 也没有契约表示——[A] 是 Universal Power（135.2.e.5/163.2.b），六域封闭 Domain 无法表示任意域资源，sfd/gold.ts 记录同一缺口；不能用普通无能力 Gear 代替。(2) 184.1/185.2.d 的 exhausted 入场状态覆盖仍缺：" +
    "effect.token 的 ARGUMENTS 集没有 entersExhausted，实测该参数抛 \"Invalid effect.token argument: entersExhausted\"，create-token 动作明确记录 \"Entry overrides are not supported\"，事后横置不等价（143.4）。(3) Hidden（811.1.b）仍无打出路径：" +
    "关键词展开为 static cost.hidden，默认 binder 以 \"Static ability kind cost.hidden has no layer mapping\" 拒绝；Hide 行动、面朝下区域、下回合 Reaction 免费打出与 811.1.d.2 的原战场目标限制都没有消费方。" +
    "已真实执行并可继续作为证据的部分：effect.damage 的 3 点伤害与 stale target 的 ignored(mistargeted) 边界。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "deal-3",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 3 },
            target: { kind: "constant", value: "damaged-unit" }
          },
          targets: [
            {
              id: "damaged-unit",
              filter: { type: "unit", location: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "Play a Gold gear token exhausted." — authored with the token args
          // the merged primitive consumes, plus the entry-stipulation argument
          // the primitive's schema rejects. The Gold definition itself is absent
          // from the frozen table (see judgeReason).
          id: "play-gold-token",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "gold" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: { kind: "constant", value: { type: "base", player: "controller" } },
            entersExhausted: { kind: "constant", value: true },
            linkKey: { kind: "constant", value: "goldToken" }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Deal 3 to a unit at a battlefield. Play a Gold gear token exhausted."
} satisfies CardProgram;

export default wagesOfPain;
