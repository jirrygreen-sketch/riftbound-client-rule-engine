import type { CardProgram } from "../../ir/index.js";

/**
 * Downwell (sfd-147-221) — Spell, 8 energy + 2 Chaos power, Chaos.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-147-221, verbatim):
 *   "Return all units and gear to their owners' hands."
 *
 * Rules evidence (Core Rules v1.5):
 * - The spell prints no [Action]/[Reaction] line, so it keeps default spell
 *   timing (159.2 / 308.1.a) and declares no speed keyword.
 * - "all units and gear" is a programmatic set, not a choice: 355.10.d (whose
 *   own example is "Kill all units at battlefields") makes objects selected by
 *   characteristics non-targeted, and 355.10.d.1 limits that exception to sets
 *   for which no choice is ever possible. No TargetSpec may be declared here,
 *   because that would fire "becomes a target" triggers (355.7, 754) for units
 *   and gear the players never chose.
 * - "Return ... to their owners' hands" is the return-to-hand action; 056.1/
 *   056.2 route each card to its OWNER's hand, which the merged effect.zone
 *   submits for `to: "hand"` (action layer, 448.2 - a zone change, not a Move).
 * - The merged effect.zone consumes a TargetSpec id or a PickSpec id only
 *   (ctx.targets / ctx.picks); it has no non-target set form, and the DSL has no
 *   non-target set spelling for it (effect.ready / effect.heal accept the
 *   { kind: "query", filter } descriptor; effect.zone does not). The primitive
 *   rejects the descriptor outright (effect.zone requires exactly one of
 *   target or pick), and the replacement planner likewise accepts only the
 *   target spelling. The intended set is therefore described with that
 *   descriptor shape and the instruction fails closed rather than
 *   approximating by targeting every unit and gear.
 *
 * Status (cards/README.md §2): judge-required — the missing non-target set form
 * of effect.zone is named (the effect.zone primitive's set/objects branch and
 * the replacement planner's matching target-only mapping), and nothing is
 * approximated. Recorded cost: 8 energy + 2 Chaos power (356.1.c).
 */
const downwell = {
  canonicalCardId: "card.hash-2d4fa47f98b9d923f7ff215e0893e6d748e4c5b8f906b289eacc50e0f83769db",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺非目标集合的「回手」形态（CR 355.10.d）：按特征程序化选出、玩家无从选择的集合不是 Target" +
    "（355.10.d.1 把例外限定为从不做选择的集合），因此不能把 “all units and gear” 改成玩家选择的 TargetSpec（355.7、754），" +
    "也不能用非目标 PickSpec 冒充自动选出的全集。" +
    "已合入的 effect.zone 只读取 Finalize 锁定的 TargetSpec（ctx.targets）或非目标 PickSpec（ctx.picks）：" +
    "对仅有 objects 描述符的指令实测抛 TypeError \"effect.zone requires exactly one of target or pick\"；" +
    "replacement/planner.ts 的 effect.zone 分支同样只接受 target 选择符（否则抛 BlockedReplacementError \"effect.zone target must be an object selector spelling\"）。" +
    "本文件按 effect.ready / effect.heal 的 {kind:'query', filter} 形状记录预期集合，指令明确失败而不是近似。" +
    "回手本身按 056.1/056.2 由动作层路由到**拥有者**手牌（effect.zone 的 to: \"hand\"），该半段已由 golden 真实执行。" +
    "依赖：effect.zone（含替代规划器）增加非目标集合分支。",
  abilities: [
    {
      kind: "play",
      cost: {
        // 印刷基础费用 8 Energy + 2 Chaos Power（356.1.c 由卡牌身份在 Finalize 绑定）。
        kind: "cost.printed",
        energy: { kind: "constant", value: 8 },
        power: { kind: "constant", value: 2 }
      },
      body: [
        {
          id: "downwell.return-all",
          // 非目标集合（355.10.d）：以已合入原语使用的 query 描述符形状记录，
          // 该形态尚未被 effect.zone 消费（见 judgeReason）。
          op: "effect.zone",
          args: {
            objects: {
              kind: "constant",
              value: {
                kind: "query",
                filter: { type: ["unit", "gear"], zone: "board" }
              }
            },
            to: { kind: "constant", value: "hand" }
          }
        }
      ]
    }
  ],
  sourceText: "Return all units and gear to their owners' hands."
} satisfies CardProgram;

export default downwell;
