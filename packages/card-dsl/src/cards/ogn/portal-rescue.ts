import type { CardProgram } from "../../ir/index.js";

/**
 * Portal Rescue (ogn-102-298) — Spell, 3 energy + 1 power, Mind.
 *
 * Printed text (packages/card-data/data/deck-catalog.json, ogn-102-298):
 *   [Action] (Play on your turn or in showdowns.)
 *   Banish a friendly unit, then play it to base, ignoring its cost.
 *
 * Modeling notes (Core Rules v1.5):
 * - [Action] (806) is declared as a keyword ability only; the Showdown
 *   permission is expanded by effects/keywords/Action.ts (contract 3.7) and
 *   enforced by the chain's own timing check (contract 3.5).
 * - "a friendly unit" is a target: the named Board unit is in a public zone
 *   (355.7 / 355.9.a.1 / 355.10), and it must be controlled by this ability's
 *   controller (355.9.b).
 * - "then play it to base" plays that same card out of Banishment as a Limited
 *   Action (420.3/420.3.a; contract 3.6 GameAction "play" with a location).
 *   The printed "then" is a result reference, so the play is linked to the
 *   banish (359.3.e.14) and reads the banished card's fresh reference from the
 *   banish receipt instead of guessing an identity: a card that changes zones
 *   to or from a Non-Board zone is a new object (124).
 * - "to base" is the destination: the acting side's Base (107.1.c/152.1: a
 *   permanent's Location is the Base or Battlefield it occupies).
 * - "ignoring its cost" sets the played card's base Energy cost and base Power
 *   cost to zero (356.1.b/356.1.b.1 — the rule text uses the word "ignore"
 *   exactly once for both costs), which is why this is not a "for [Cost]"
 *   rewrite (356.1.a) and not the single-resource "ignoring its Energy cost"
 *   half (356.1.b.2); 356.6 still forbids reducing below 0 and 356.1.b.3 keeps
 *   additional costs. The merged cost system models this as
 *   BaseCostModification { kind: "ignore-base", ignore: "resources" }
 *   (cost/cost-plan.ts) and the merged cost.modify primitive (RIFT-261) really
 *   builds that finalized plan for the caller's CostSpec.
 *
 * Status: judge-required. The banish half (effect.banish, 428.1) and the plan
 * arithmetic are merged and executed by the golden; the play half still cannot
 * run from card IR. The play instruction keeps a pending cost descriptor that
 * names the required finalization instead of a descriptor that would be
 * misread: no merged consumer turns it into the FinalizedCostPlan that
 * effect.play requires, cost.modify has no card-IR dispatch (its literal
 * metadata is not decoded by chain/interpreter-adapter.ts), and the plan must
 * be built from the chosen card's own printed costs while cost.modify can only
 * read ctx.source. Both instructions stay linked, and the banished card's
 * reference is read from the receipt.
 */
const portalRescue = {
  canonicalCardId: "card.hash-9595373fe14cedf30b615fbf8b92e3f4477e887d643fbebe7041a8501669ee50",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺口（复核 2026-10-17，依赖已变化）：cost.pay/cost.modify 原语与 cost/cost-plan.ts 的 " +
    "BaseCostModification { kind: \"ignore-base\", ignore: \"resources\" }（356.1.b/356.1.b.1，356.6 的下限）均已合入，" +
    "golden 已用真实的 cost.modify 原语执行让计划变成 total { energy: 0, power: [] }；但没有任何已合入消费方把本卡的费用描述符变成 " +
    "effect.play 需要的 FinalizedCostPlan：① 链的生产派发（chain/interpreter-adapter.ts 的 primitiveArgs 只解码 effect.* 的 " +
    "LITERAL_FIELDS）不解析卡内 cost.modify 的 args——实测经 resolveChainBody 派发卡内 cost.modify 会抛 " +
    "\"cost.modify id must be a non-empty string\"（id 仍是 Expr）；② 计划必须按 356.1.b.1 读取**被 banished 的那张牌**的印刷费用并置零，" +
    "而 cost.modify 的 cost 参数是静态 CostSpec，只有调用方给的 ctx.source 可读，本卡没有任何路径为运行期被选对象生成计划；" +
    "③ effect.play 只接受已 finalize 的计划（它不推导印刷费用、也不实现忽略费用规则）。" +
    "已合入并由 golden 真实执行的半段：effect.banish（428.1）与 effect.play 本体的目标/位置参数（420.3/420.3.a），" +
    "两条指令保持 linkedTo（359.3.e.14），banished 卡的新引用从回执读取（124）。" +
    "依赖：费用描述符→Finalize 计划的卡牌侧消费接线（含运行期被选对象印刷费用读取；具体缺口为 " +
    "cost.modify 的卡牌 IR 派发与 effect.play 的 finalized 计划生产者），不近似实现" +
    "（不按印刷费用打出、不手写计划、不为免费打出）。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "portal-rescue.banish-friendly-unit",
          op: "effect.banish",
          args: {
            objects: { kind: "constant", value: { target: "portal-rescue.friendly-unit" } },
            amount: { kind: "constant", value: 1 },
            linkKey: { kind: "constant", value: "banished" }
          },
          targets: [
            {
              id: "portal-rescue.friendly-unit",
              filter: { type: "unit", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "then play it to base, ignoring its cost" (420.3/420.3.a,
          // 356.1.b.1). The banished card's fresh reference comes from the
          // banish receipt; the cost argument records the required
          // finalization (both base costs zero, 356.6 floor) that no merged
          // producer materializes yet.
          id: "portal-rescue.play-to-base",
          op: "effect.play",
          linkedTo: "portal-rescue.banish-friendly-unit",
          args: {
            object: {
              kind: "linked-value",
              instructionId: "portal-rescue.banish-friendly-unit",
              key: "banishedObject"
            },
            location: {
              kind: "constant",
              value: { type: "base", player: "controller" }
            },
            cost: {
              kind: "constant",
              value: {
                kind: "cost.modify",
                base: "printed",
                ignore: ["energy", "power"],
                minimum: 0,
                finalized: false
              }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Banish a friendly unit, then play it to base, ignoring its cost."
} satisfies CardProgram;

export default portalRescue;
