import type { CardProgram } from "../../ir/index.js";

/**
 * Sudden Storm (sfd-017-221) — Spell, 3 Energy, no printed Power, Fury.
 *
 * Printed text:
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for
 *   :rb_energy_0:.)
 *   [Action] (Play on your turn or in showdowns.)
 *   Deal 2 to a unit at a battlefield. If it's attacking, deal 4 to it instead.
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json, sfd-017-221):
 * cardType Spell, domains ["Fury"], energy 3, power null, might null, tags [].
 * power null means no printed Power and is never rewritten as 0.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Hidden] (811) and [Action] (806) are keyword abilities declared on the
 *   card; Hidden's expansion (811.1.b Hide permission, 811.1.c.2 Discretionary
 *   Action, 811.6 Reaction from the next turn) and Action's Showdown permission
 *   (806.1.c, 159.2.a) are owned by the keyword registry, the cost/zone work and
 *   the chain's timing query (contract 3.5/3.7). The card names both keywords
 *   and nothing more.
 * - "a unit at a battlefield" is a Choice of a specific Game Object in a Public
 *   zone, so the unit is Targeted (355.5, 355.7, 355.10.a); "at a battlefield"
 *   is a targeting restriction on that unit and does not target a battlefield
 *   (355.10.b). It is carried as the TargetSpec's own `location` field (the
 *   merged `TargetRequirement.location`).
 * - "If it's attacking, deal 4 to it instead" replaces the amount for the same
 *   target when that target is an attacker. It is one Deal action whose amount
 *   depends on the target's combat state, so the program states the two printed
 *   amounts as two mutually exclusive `effect.damage` instructions over the same
 *   TargetSpec, each guarded by a per-instruction `condition` (contract 3.4:
 *   a condition clause scopes to the instruction that owns it). "it" refers to
 *   the unit chosen by the preceding sentence, so the second instruction is
 *   `linkedTo` the first (359.3.e.14). Both instructions resolve the same
 *   Finalize-locked target set (355.8), and a stale target ignores both
 *   (359.3.e.14.a).
 * - "attacking" means the unit currently holds the Attacker designation
 *   (807.1.d.1 / 461 defines the designation gained in Combat). Contract 3.8
 *   adds `combatRole: "attacker" | "defender" | null` to `ObjectSnapshot` for
 *   exactly this reading; the condition below reads it as
 *   `object-property(target, "combatRole")`, which is fail-closed while the
 *   field is missing (the interpreter reports missing information instead of
 *   guessing the state, so no wrong amount is ever dealt).
 *
 * Status: judge-required, with both gaps named:
 * - `combatRole` is not merged into `ObjectSnapshot`, so "it's attacking" cannot
 *   be evaluated (contract 3.8 item 1; the same gap the merged Assault / Shield
 *   cards record for their designations). Neither amount is approximated: the
 *   conditions are written honestly and the missing characteristic makes the
 *   instruction ignored rather than dealing a substituted amount.
 * - [Hidden]'s expansion still has no consumer (RIFT-84 declared cost.hidden,
 *   no code grants Hide or the facedown play; RIFT-89 owns the cost work).
 */
const TARGET_ID = "sudden-storm.unit-at-battlefield";

const target = {
  id: TARGET_ID,
  // 355.9.a.1: "unit" means a Board object unless stated otherwise; the
  // battlefield restriction is the merged TargetRequirement.location.
  filter: { type: "unit", zone: "board" },
  location: { type: "battlefield" },
  min: 1,
  max: 1,
  selection: "one"
} as const;

export default {
  canonicalCardId: "card.hash-574418734c3b92b767c220f89099980a68fad40a1074ee6c38bc88c7efb84771",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1)「If it's attacking」需要读取目标的战斗身份，而契约 3.8 第 1 条才要求给 " +
    "ObjectSnapshot 增加 combatRole（attacker/defender/null），当前 interpreter 的 ObjectSnapshot 与图层过滤器都没有该特征" +
    "（807.1.d.1/461 的 Attacker designation；已合入的 Assault/Shield 卡牌记录同一缺口）。条件按 object-property(target, 'combatRole') " +
    "如实书写，字段缺失时解释器按缺信息把指令 ignored（fail-closed），不会结算被替换的错误数额。" +
    "(2) [Hidden] 展开仍无消费方：RIFT-84 已合入 keywords/Hidden.ts 的 cost.hidden 声明，但没有代码据它授予 Hide 动作或 " +
    "「从 facedown 打出」许可（811.1.b / 811.1.c / 811.6；依赖 RIFT-89 的费用/区域批次）。" +
    "[Action] 声明、目标（355.5/355.7/355.10.b + TargetRequirement.location）与两个互斥的 effect.damage 数额已如实编码，" +
    "且用真实原语测试锁定目标的伤害与 stale 目标边界。依赖：契约 3.8 combatRole 落地（RIFT-91 图层条件求值）、RIFT-84/RIFT-89（Hidden）。",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      // Printed cost (3 Energy, no Power) comes from the catalog; the Finalize
      // cost plan is its consumer.
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 3 }
      },
      body: [
        {
          // "Deal 2 to a unit at a battlefield" — the printed amount for a unit
          // that is not an attacker.
          id: "sudden-storm.deal-2",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 2 },
            target: { kind: "constant", value: TARGET_ID }
          },
          targets: [target],
          condition: {
            kind: "not",
            condition: {
              kind: "compare",
              left: {
                kind: "object-property",
                object: { target: TARGET_ID },
                property: "combatRole"
              },
              operator: "eq",
              right: { kind: "constant", value: "attacker" }
            }
          }
        },
        {
          // "If it's attacking, deal 4 to it instead" — the replacement amount
          // for the same chosen unit (359.3.e.14: "it" references the unit of
          // the first sentence, hence the link).
          id: "sudden-storm.deal-4",
          op: "effect.damage",
          linkedTo: "sudden-storm.deal-2",
          args: {
            amount: { kind: "constant", value: 4 },
            target: { kind: "constant", value: TARGET_ID }
          },
          targets: [target],
          condition: {
            kind: "compare",
            left: {
              kind: "object-property",
              object: { target: TARGET_ID },
              property: "combatRole"
            },
            operator: "eq",
            right: { kind: "constant", value: "attacker" }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Deal 2 to a unit at a battlefield. If it's attacking, deal 4 to it instead."
} satisfies CardProgram;
