import type { CardProgram } from "../../ir/index.js";

/**
 * Forge of the Fluft (sfd-208-221) — Battlefield, SFD.
 *
 * "While you control this battlefield, friendly legends have
 *  ':rb_exhaust:: Attach an Equipment you control to a unit you control.'"
 *
 * Rules anchors (Core Rules v1.5):
 * - A battlefield's abilities are controlled by the battlefield's controller
 *   (190.6.a); "you" in a battlefield's abilities therefore means that
 *   controller (190.6.d), which is the "While you control this battlefield"
 *   window encoded as the condition below.
 * - The quoted clause grants each friendly legend a complete activated
 *   ability: the [E] symbol is the cost "Exhaust this" (415.3.a, 415.5), and
 *   "Attach an Equipment you control to a unit you control" is the Attach
 *   action (435.1/435.3) with two chosen objects, so both objects are targets
 *   (355.7, 355.9.a.1); 435.3 explicitly notes that the game effect doing the
 *   attaching may choose targets.
 * - Legends are game objects that may have activated abilities (174.8) and can
 *   be targeted by game effects (174.5).
 * - The survey for this exact printing (docs/plans/survey/unclassified-rad-sfd.md §9)
 *   records the required new boundary as `continuous.grant-ability`: attach a
 *   complete triggered/activated ability to a set of objects while preserving
 *   source, payment, triggers, targets and duration.
 *
 * Status rationale (contract 3.1): judge-required, current gaps:
 * 1. no `continuous.grant-ability` primitive is merged: the layers engine only
 *    consumes might / keyword / type / tag / timing / movement / text effects
 *    (see engine-core/src/layers/engine.ts applyAbility/applyArithmetic) and
 *    there is no instruction/consumer that attaches a complete activated
 *    ability to a set of objects;
 * 2. even with a grant, the granted ability has no activation/chain/resolution
 *    entry: program activation (programs/activate.ts) reads the card's own
 *    expanded abilities only, never an object-level granted ability. The [E]
 *    exhaust cost itself is payable by the merged cost plan (kind "exhaust"),
 *    which the golden executes as isolated evidence.
 * The static effect below preserves the grant shape (filter + granted
 * activated ability) so it is reviewable; no substitute exhaust/attach flow is
 * written into the card.
 */
export default {
  canonicalCardId: "card.hash-3f356b3b6d2a071862d185320450d863f378794fba0b10d4731b81a16bd21498",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口：(1) continuous.grant-ability 原语不存在——把一条完整激活能力（保留来源、支付、目标与持续期，" +
    "见 135.4.b / 801.3.a）授予一组对象的能力边界没有已注册实现；layers（engine-core/src/layers/engine.ts）只消费 " +
    "might/keyword/type/tag/timing/movement/text 类持续效果。(2) 被授予能力的激活/入链/结算入口未接通：" +
    "programs/activate.ts 只读取卡牌自身展开的 activated 能力，没有对象级授予能力的启动路径。" +
    "[E]（415.3.a/415.5）的 exhaust 支付本身已可由 merged 费用计划支付，golden 以该孤立执行作为证据；" +
    "continuous.grant-ability 是 RIFT-9 调研记录的新原语（docs/plans/survey/unclassified-rad-sfd.md）。" +
    "依赖该新原语与授予能力的启动接线，不近似实现。",
  sourceText:
    "While you control this battlefield, friendly legends have \":rb_exhaust:: Attach an Equipment you control to a unit you control.\"",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.grant-ability",
        appliesTo: "friendly-legends",
        filter: { type: "legend", controller: "self" },
        ability: {
          kind: "activated",
          timing: "action",
          cost: { payments: [{ kind: "exhaust" }] },
          body: [
            {
              id: "forge-of-the-fluft.attach",
              op: "effect.attach",
              args: {
                objects: { kind: "constant", value: { kind: "target", id: "forge-of-the-fluft.equipment" } },
                host: { kind: "constant", value: { kind: "target", id: "forge-of-the-fluft.unit" } }
              },
              targets: [
                {
                  id: "forge-of-the-fluft.equipment",
                  filter: { type: "gear", tags: ["Equipment"], controller: "self" },
                  min: 1,
                  max: 1,
                  selection: "one"
                },
                {
                  id: "forge-of-the-fluft.unit",
                  filter: { type: "unit", controller: "self" },
                  min: 1,
                  max: 1,
                  selection: "one"
                }
              ]
            }
          ]
        }
      },
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "objects",
          filter: { object: "self", controller: "self" }
        },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
    }
  ]
} satisfies CardProgram;
