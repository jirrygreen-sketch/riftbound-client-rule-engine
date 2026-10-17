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
 * - "if you paid the additional cost" is the additional conditional statement
 *   immediately after the Condition, so 383.2.a.1 makes it part of the Trigger
 *   Condition; 356.4.f.1 defines "paid" by the player's decision to pay, not by
 *   the amount actually paid. The merged IR spells it as a `result`
 *   TriggerSpec.condition (RIFT-359), read from the finalized
 *   { plan, receipt } pair by effects/interpreter/predicates/result.ts.
 *
 * Status: judge-required. Re-checked against the merged source; three links are
 * still open, and nothing is approximated:
 * - CardProgram -> CostPlanInput: no merged consumer reads a program's static
 *   `cost.additional` declaration. programs/play.ts builds the play draft only
 *   from a PlayAbility's own `cost` and translateCost rejects the additional
 *   spellings outright ("Unsupported play cost field optional"; "Additional
 *   costs are not bound"), and createEngineStaticBinder.bindStatic has no layer
 *   mapping for that effect kind ("Static ability kind cost.additional has no
 *   layer mapping"). The merged cost layer (cost/cost-plan.ts
 *   optionalAdditional + cost/plan-values.ts "kill") can plan and pay the
 *   shape, but only when a caller supplies it.
 * - Cost-choice option resolution: cost/plan-values.ts choiceObjects requires
 *   every option to be an exact runtime ObjectRef (id + zoneEntryId). Nothing
 *   merged resolves the declared "dynamic:friendly-gear" placeholder, or the
 *   friendly-gear filter behind it, into that locked list at Finalize.
 * - 356.4.f.1 paid receipt reaches the trigger: chain/engine.ts keeps the
 *   played card's finalized receipt on that item's `item.payment`, and
 *   events/pipeline.ts evaluates TriggerSpec.condition through
 *   host.context(source, controller, timingPoint) with the event payload only;
 *   the trigger's Resolve options therefore never receive
 *   `{ plan, receipt }`. The merged `result` predicate fires only when those
 *   cost inputs are supplied (proved in the golden), so the real card-played
 *   wave throws MissingInformation and the play rolls back instead of gating
 *   "kill a gear" on the decision. The body instruction is NOT gated instead,
 *   because 383.2.a.1 makes the clause part of the Condition.
 * The Kill body instruction itself is the merged effect.kill primitive and is
 * executed against a Finalize-locked target in the golden test; the golden also
 * charges the declared kill shape through the merged cost planner and its
 * payment receipt with a locked friendly-gear pick, which isolates the three
 * remaining links above.
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
      filter: { event: "card-played", filter: { source: "self" } },
      // 383.2.a.1 + 356.4.f.1: "if you paid the additional cost" is part of the
      // Trigger Condition and reads the finalized optional-cost decision. The
      // decided/finalized receipt is not yet reachable here (see judgeReason).
      condition: {
        kind: "result",
        result: "additional-cost-paid",
        id: "zaun-punk.additional-cost"
      }
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
    "385/383.2.a.1 的触发条件「if you paid the additional cost」与 356.4.f.1 的「支付只看决定」已可用 IR 的 result 谓词表达" +
    "（effects/interpreter/predicates/result.ts 从 { plan, receipt } 读取），effect.kill 本体（429.1/429.6）也已合入并在 golden 中真实执行。" +
    "仍缺三条接线，均不近似实现：" +
    "(1) 356.2.b/356.2.b.1 的可选附加费用由被打出卡牌的被动能力声明（决定属于 355.1/355.1.a 的费用步骤），" +
    "但没有任何已合入消费方把 CardProgram 声明的 static cost.additional 接进 CostPlanInput——" +
    "programs/play.ts 只用 PlayAbility 自身的 cost（translateCost 实测抛 \"Additional costs are not bound\" / \"Unsupported play cost field optional\"），" +
    "createEngineStaticBinder.bindStatic 也对该 effect kind 抛 \"Static ability kind cost.additional has no layer mapping\"；" +
    "已合入的 cost/ 计划（cost/cost-plan.ts 的 optionalAdditional 与 cost/plan-values.ts 的 kill 形状）只能由调用方传入。" +
    "(2) 费用选择项解析：cost/plan-values.ts 的 choiceObjects 要求每个 option 都是运行时精确 ObjectRef（id + zoneEntryId），" +
    "没有任何已合入模块把卡牌程序里的 \"dynamic:friendly-gear\" 占位符（或其 friendly-gear 过滤器）在 Finalize 解析成该锁定列表，" +
    "golden 实测原样传入会被拒绝为 \"Cost requires an exact object reference\"。" +
    "(3) 356.4.f.1 支付回执到触发条件的绑定：chain/engine.ts 把被打出牌的最终回执保存在该牌的 item.payment，" +
    "而 events/pipeline.ts 求值 TriggerSpec.condition 时只经 host.context(source, controller, timingPoint) 提供事件载荷，" +
    "触发项的 Resolve options 收不到被打出牌的 { plan, receipt }；golden 实测真实 card-played 波次因此抛 MissingInformation 并回滚整次打出，" +
    "而不是把「kill a gear」按支付决定开闸。" +
    "依赖：CardProgram static cost.additional 的 Finalize 消费方、费用选择项的运行时 ObjectRef 解析、以及被打出牌回执到 Play Effect 触发条件的绑定。",
  abilities,
  sourceText:
    "You may kill a friendly gear as an additional cost to play me.\n" +
    "When you play me, if you paid the additional cost, kill a gear."
} satisfies CardProgram;

export default program;
