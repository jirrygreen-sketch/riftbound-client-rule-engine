import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Riven, Broken Blade (rad-043-167) — Unit, 4 energy, 4 Might, 无印刷力量值。
 *
 * 原文："When I become exhausted, choose one that hasn't been chosen this turn —\n"
 *       "[Buff] me. (Give me a +1 :rb_might: buff if I don't have one.)" +
 *       "Spend my buff to [Stun] an enemy unit. (It doesn't deal combat damage this turn.)" +
 *       "Spend my buff to ready me."
 *
 * 规则依据（CR v1.5）：
 * - "When I become exhausted"：415.1.b（从就绪变为横置的瞬间）、时点 object-exhausted
 *   （415.1 / 415.1.c）。
 * - "choose one that hasn't been chosen this turn"：303 / 319 的"本回合已作过的选择"记录；
 *   RIFT-9 调研为 rad-043-167 / rad-179-167 规划的专用原语是
 *   `choice.exclusive-once-per-turn`（把多个模式分支绑定到同一回合历史收据，并限制每个
 *   分支在该回合最多被选择一次）。IR 的 `choice.mode`（契约 3.9）只保证单次结算内
 *   count=1 / different=true，不能承载"本回合未选过"这一跨触发历史，故整卡 judge-required。
 * - "[Buff] me"：Buffs（702）——effect.buff mode "buff" 放在自身（702.2.a、702.3.a）。
 * - "Spend my buff to [Stun] an enemy unit" / "Spend my buff to ready me"：
 *   "[do X] to [do Y]" 是**指令内费用**（355.10.c.1 / 404.1.b.1），费用未支付时 Y 不得结算。
 *   费用计划确实支持 spend-buff 支付（cost/plan-values.ts 与 cost/payment.ts 的
 *   spend-buff 分支，检查 Buff 数量并提交 spend-buff 动作），但没有把它作为“指令内费用”
 *   接进卡牌 body 的指令原语（effects/instructions/ 无 cost.pay/effect.spend-buff 门控）。
 *   已合入的 effect.buff mode "spend" 只描述"消耗一个 Buff"这一动作，本身不是费用：
 *   按契约 3.4，negated 的指令其后续链接指令仍会尽可能执行，因此不能把
 *   `effect.buff(spend)` + linkedTo 当作"支付失败则不 Stun / 不 Ready"。
 *   不把 spend-buff 降级成普通 Might 修改（702.2.b.1 的"没有 Buff 就不能消耗"语义会丢失）。
 * - [Stun] 与 ready：424（Stunned 状态；424.1.a.1 已 Stunned 不再重复）与 416.1（Ready）；
 *   两者原语 effect.stun / effect.ready 已合入。
 *
 * status 判定（README 第 2 节，2026-10-17 复核）：judge-required。缺口（均实测）：
 * - `choice.exclusive-once-per-turn`（本回合未选过的分支记录，303 / 319）：IR 的 choice.mode
 *   只在单次结算内保证 count=1 / different=true，不能承载跨触发的回合历史（无已分配任务号）。
 * - 指令内 Buff 支付门控：实测在 0 个 Buff 时，spend 指令 negated/skipped，但 linkedTo 的
 *   stun 与 ready 仍然 executed（敌人照样被 Stun、自己被 Ready）——证明 linkedTo 不是
 *   「支付成功才结算」的门控。cost.pay 原语已合入，但 success-gated payment body 仍缺
 *   （cost/kinds/README.md 契约变更请求 #2）；已合入的 effect.buff mode "spend" 不构成门控。
 * - 整条触发体的 choice.mode 还进不了生产链：实测 chain/engine.ts 的
 *   assertFinalizationSurface 抛 ChainContractBlockedError「Mode choices require a
 *   Finalize/Resolve choice-plan adapter」。
 * CardProgram → TriggerRegistration 已有生产适配器；嵌套 {source:"self"}
 * 锚点经 translateTriggerFilter 已能翻译成
 * {event:"object-exhausted", object:{objectId:"src"}}，翻译后的 registration 也通过
 * 严格校验。触发绑定不再是本卡缺口。
 * 分支结构已按契约 3.9 用 choice.mode 完整写出，已合入的 effect.buff / effect.stun /
 * effect.ready 在 golden 测试里用解释器 + 参考内核真实执行。
 */

const MYSELF = "riven-broken-blade.self";
const ENEMY_UNIT = "riven-broken-blade.enemy-unit";

const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "object-exhausted",
      filter: { event: "object-exhausted", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "riven-broken-blade.choose",
        op: "choice.mode",
        args: {
          count: { kind: "constant", value: 1 },
          different: { kind: "constant", value: true },
          prompt: { kind: "constant", value: "Choose one that hasn't been chosen this turn." },
          // 303 / 319 的"本回合未选过"收据由 choice.exclusive-once-per-turn 承担（未注册）。
          modes: {
            kind: "constant",
            value: [
              {
                id: "riven-broken-blade.buff-mode",
                body: [
                  {
                    id: "riven-broken-blade.buff-me",
                    op: "effect.buff",
                    args: {
                      mode: { kind: "constant", value: "buff" },
                      target: { kind: "constant", value: MYSELF }
                    },
                    targets: [
                      {
                        id: MYSELF,
                        filter: { type: "unit", object: "self" },
                        min: 1,
                        max: 1,
                        selection: "one"
                      }
                    ]
                  }
                ]
              },
              {
                id: "riven-broken-blade.stun-mode",
                body: [
                  {
                    // "Spend my buff to ..." 的支付侧：RIFT-9 规划的费用式 effect.spend-buff
                    // 未注册；此处用已合入的 effect.buff mode "spend" 记录"消耗一个 Buff"，
                    // 但它不构成对下一条指令的费用门控（见 judgeReason）。
                    id: "riven-broken-blade.spend-buff-for-stun",
                    op: "effect.buff",
                    args: {
                      mode: { kind: "constant", value: "spend" },
                      target: { kind: "constant", value: MYSELF }
                    },
                    targets: [
                      {
                        id: MYSELF,
                        filter: { type: "unit", object: "self" },
                        min: 1,
                        max: 1,
                        selection: "one"
                      }
                    ]
                  },
                  {
                    id: "riven-broken-blade.stun-enemy",
                    op: "effect.stun",
                    linkedTo: "riven-broken-blade.spend-buff-for-stun",
                    args: {
                      target: { kind: "constant", value: ENEMY_UNIT }
                    },
                    targets: [
                      {
                        id: ENEMY_UNIT,
                        filter: { type: "unit", controller: "opponent", zone: "board" },
                        min: 1,
                        max: 1,
                        selection: "one"
                      }
                    ]
                  }
                ]
              },
              {
                id: "riven-broken-blade.ready-mode",
                body: [
                  {
                    id: "riven-broken-blade.spend-buff-for-ready",
                    op: "effect.buff",
                    args: {
                      mode: { kind: "constant", value: "spend" },
                      target: { kind: "constant", value: MYSELF }
                    },
                    targets: [
                      {
                        id: MYSELF,
                        filter: { type: "unit", object: "self" },
                        min: 1,
                        max: 1,
                        selection: "one"
                      }
                    ]
                  },
                  {
                    id: "riven-broken-blade.ready-me",
                    op: "effect.ready",
                    linkedTo: "riven-broken-blade.spend-buff-for-ready",
                    args: {
                      objects: { kind: "constant", value: { kind: "source" } },
                      amount: { kind: "constant", value: 1 }
                    }
                  }
                ]
              }
            ]
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-92a8f107905f2dafc89ae0242541a797fd2b39c572e28a280cde2e6ef343444f",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处缺口（2026-10-17 复核，均实测，不近似实现）：(1) 「choose one that hasn't been chosen this turn」" +
    "需要跨触发的回合历史收据（303 / 319）；IR 的 choice.mode 只在单次结算内保证 count=1/different=true，" +
    "没有 choice.exclusive-once-per-turn 之类原语（无已分配任务号）。" +
    "(2) 「Spend my buff to [Stun]/ready」的「[do X] to [do Y]」是指令内费用（355.10.c.1/404.1.b.1）：" +
    "实测在 0 个 Buff 时 spend 指令 negated/skipped 而 linkedTo 的 stun 与 ready 仍然 executed" +
    "（敌人照样被 Stun、自己被 Ready），证明 linkedTo 不是「支付成功才结算」的门控；" +
    "cost.pay 原语已合入，但 success-gated payment body 仍缺（cost/kinds/README.md 契约变更请求 #2）。" +
    "已合入的 effect.buff mode \"spend\" 只是消耗动作，按契约 3.4 的 negated 语义" +
    "不构成对后续链接指令的费用门控（不把 spend-buff 降级为普通 Might 修改，见文件头注释）。" +
    "(3) 整条触发体的 choice.mode 进不了生产链：实测 chain/engine.ts 的 assertFinalizationSurface 抛 " +
    "ChainContractBlockedError「Mode choices require a Finalize/Resolve choice-plan adapter」。" +
    "已合入的 effect.buff / effect.stun / effect.ready 由 golden 测试用解释器 + 参考内核真实执行。" +
    "依赖：success-gated payment body（cost/kinds/README.md 契约变更请求 #2）、Finalize/Resolve choice-plan 适配器。",
  abilities,
  sourceText:
    "When I become exhausted, choose one that hasn't been chosen this turn —\n" +
    "[Buff] me. (Give me a +1 :rb_might: buff if I don't have one.)" +
    "Spend my buff to [Stun] an enemy unit. (It doesn't deal combat damage this turn.)" +
    "Spend my buff to ready me."
} satisfies CardProgram;

export default program;
