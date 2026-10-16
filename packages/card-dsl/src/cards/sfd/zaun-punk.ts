import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Zaun Punk (sfd-160-221) — Unit, 3 energy, Might 3, Order, tag Zaun.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-160-221):
 *   You may kill a friendly gear as an additional cost to play me.
 *   When you play me, if you paid the additional cost, kill a gear.
 *
 * Rules evidence (Core Rules v1.5):
 * - "You may kill a friendly gear as an additional cost to play me." is an
 *   Optional Additional Cost specified by a Passive Ability on the card being
 *   played (356.2.b / 356.2.b.1); the decision to pay belongs to the play
 *   procedure's cost steps (355.1 / 355.1.a) and the component is applied at
 *   356.2. The killed friendly gear is a cost component, chosen by its
 *   controller (355.10.c: a game object included as part of a cost is not a
 *   target).
 * - "When you play me" is a Play Effect (383.4.a): the card-played timing
 *   point filtered to this card.
 * - "kill a gear" names a specific object in a public zone, so it is a Target
 *   (355.7, 355.9.a, 355.10.a); 429.6 formats Kill as "Kill [one or more
 *   permanents]". The ceiling "a gear" is not qualified as friendly, so both
 *   controllers' gears are legal.
 * - "if you paid the additional cost": 356.4.f.1 states an optional
 *   additional cost was "paid" when the player made the decision to pay it,
 *   regardless of how much was actually paid.
 *
 * Status: judge-required — both halves are declared, and the missing pieces
 * are named instead of approximated:
 * - there is no merged instruction primitive for an additional cost
 *   (effects/instructions/ contains only effect.* files), and no code turns a
 *   card program's declared cost into the merged cost planner's
 *   CostPlanInput (cost/cost-plan.ts consumes an optionalAdditional list from
 *   its caller); the merged kill payment kind supports the *charge* shape
 *   (cost/plan-values.ts accepts kind "kill"), but nothing wires a card
 *   program into it (RIFT-89 / RIFT-9 cost.additional, cost.sacrifice).
 * - "if you paid the additional cost" needs the paid receipt at resolution
 *   (356.4.f.1); the frozen IR has no cost-result binding (the survey records
 *   it as condition.result), so the kill cannot be gated. The body instruction
 *   below is deliberately left ungated rather than gated by an invented
 *   condition that would always evaluate true.
 * The Kill body instruction itself is the merged effect.kill primitive and is
 * executed against a Finalize-locked target in the golden test.
 */
const abilities: Ability[] = [
  {
    // 356.2.b / 356.2.b.1: Optional Additional Cost imposed by a Passive
    // Ability of the card being played. The merge (kill) is a cost component,
    // not a target (355.10.c); the component id is stable for the cost plan.
    kind: "static",
    effect: {
      kind: "cost.additional",
      id: "zaun-punk.additional-cost",
      appliesTo: "self",
      optional: true,
      stage: "optional-additional",
      payments: [
        {
          kind: "kill",
          amount: { kind: "constant", value: 1 },
          choice: {
            id: "zaun-punk.friendly-gear",
            options: ["dynamic:friendly-gear"],
            min: 1,
            max: 1,
            selection: "one",
            filter: { type: "gear", zone: "board", controller: "controller" }
          }
        }
      ]
    }
  },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "zaun-punk.kill-gear",
        op: "effect.kill",
        args: {
          target: { kind: "constant", value: "zaun-punk.gear" }
        },
        targets: [
          {
            id: "zaun-punk.gear",
            filter: { type: "gear", zone: "board" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-5433b0927a4bc2a2f4e5d52590d57b1bec38882780434c5aed6ac38f5eb85c16",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺「可选追加费用」的收取与回执：effects/instructions/ 没有 cost.additional / cost.sacrifice 指令原语（RIFT-9 清单），" +
    "也没有把卡牌程序声明的费用接进已合入 cost/ 计划的接线（buildCostPlan 只消费调用方传入的 optionalAdditional）；" +
    "已合入的费用组件词汇含 kill（cost/plan-values.ts 的 nonstandard cost），但无卡牌程序→费用计划的入口（RIFT-89）。" +
    "356.4.f.1 规定「If you paid the additional cost」以「玩家决定支付」为凭证，冻结 IR 没有费用结果绑定（调研记为 condition.result），" +
    "故第二条（kill a gear）无法按已付/未付开闸；不伪造恒真条件，也不把费用改写成效果。" +
    "effect.kill 本体（429.1/429.6）已合入，golden 用锁定目标真实执行 kill；整卡因费用与回执缺口保持 judge-required。" +
    "依赖：RIFT-9（cost.additional / cost.sacrifice）、RIFT-89（费用计划接线与回执）。",
  abilities,
  sourceText:
    "You may kill a friendly gear as an additional cost to play me.\n" +
    "When you play me, if you paid the additional cost, kill a gear."
} satisfies CardProgram;

export default program;
