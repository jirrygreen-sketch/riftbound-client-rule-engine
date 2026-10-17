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
 * Status: judge-required. Re-checked against the merged source; three links
 * are still missing, and nothing is approximated:
 * - CardProgram -> CostPlanInput: no merged consumer reads a program's static
 *   `cost.additional` declaration. programs/play.ts builds the play draft only
 *   from a PlayAbility's own `cost` and translateCost rejects the additional
 *   spellings outright ("Unsupported play cost field optional"; "Additional
 *   costs are not bound"), and programs/triggers.ts never turns a static
 *   additional-cost ability into TriggerRegistration.cost. The merged cost
 *   layer (cost/cost-plan.ts optionalAdditional + cost/plan-values.ts "kill")
 *   can plan and pay the shape, but only when a caller supplies it.
 * - Cost-choice option resolution: cost/plan-values.ts choiceObjects requires
 *   every option to be an exact runtime ObjectRef (id + zoneEntryId). Nothing
 *   merged resolves the declared "dynamic:friendly-gear" placeholder, or the
 *   friendly-gear filter behind it, into that locked list at Finalize.
 * - 356.4.f.1 paid receipt: the frozen Condition kinds are
 *   always/never/compare/all/any/not/expression (the survey records the missing
 *   one as condition.result), chain/engine.ts keeps the finalized receipt on
 *   item.payment without exposing it to the trigger's Resolve context, and the
 *   production pipeline host supplies no testTrigger adapter, so a
 *   condition-carrying registration could not be evaluated either. The body
 *   instruction below therefore stays ungated instead of gated by an invented
 *   always-true condition.
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
    "仍缺三条接线，均不近似实现：" +
    "(1) 356.2.b/356.2.b.1 要求可选附加费用由被打出卡牌的被动能力声明（决定属于 355.1/355.1.a 的费用步骤），" +
    "但没有任何已合入消费方把 CardProgram 声明的 static cost.additional 接进 CostPlanInput——" +
    "programs/play.ts 只用 PlayAbility 自身的 cost（translateCost 直接拒绝 additional/optional 拼写：\"Unsupported play cost field optional\"、\"Additional costs are not bound\"），" +
    "programs/triggers.ts 也不会把 static 附加费用能力变成 TriggerRegistration.cost；" +
    "已合入的 cost/ 计划（cost/cost-plan.ts 的 optionalAdditional 与 cost/plan-values.ts 的 kill 形状）只能由调用方传入。" +
    "(2) 费用选择项解析：cost/plan-values.ts 的 choiceObjects 要求每个 option 都是运行时精确 ObjectRef（id + zoneEntryId），" +
    "没有任何已合入模块把卡牌程序里的 \"dynamic:friendly-gear\" 占位符（或其 friendly-gear 过滤器）在 Finalize 解析成该锁定列表。" +
    "(3) 356.4.f.1 支付回执：冻结 IR 的 Condition 只有 always/never/compare/all/any/not/expression（调研记为 condition.result），" +
    "chain/engine.ts 把最终费用回执保存在 item.payment，未暴露给触发能力的 ResolveContext，生产管线宿主也没有 testTrigger 适配器，" +
    "故第二条（kill a gear）无法按已付/未付开闸；不伪造恒真条件，也不把费用改写成效果。" +
    "effect.kill 本体（429.1/429.6）已合入，golden 用锁定目标真实执行 kill，并用锁定的 friendly gear pick 真实走通费用计划与回执。" +
    "依赖：CardProgram static cost.additional 的 Finalize 消费方、费用选择项的运行时 ObjectRef 解析、以及 356.4.f.1 支付回执到触发条件的绑定。",
  abilities,
  sourceText:
    "You may kill a friendly gear as an additional cost to play me.\n" +
    "When you play me, if you paid the additional cost, kill a gear."
} satisfies CardProgram;

export default program;
