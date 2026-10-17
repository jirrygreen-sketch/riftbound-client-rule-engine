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
 *   本卡需要等价于 `choice.exclusive-once-per-turn` 的历史能力（把多个模式分支绑定到同一回合历史收据，并限制每个
 *   分支在该回合最多被选择一次）。IR 的 `choice.mode`（契约 3.9）只保证单次结算内
 *   count=1 / different=true，不能承载"本回合未选过"这一跨触发历史，故整卡 judge-required。
 * - "[Buff] me"：Buffs（702）——effect.buff mode "buff" 放在自身（702.2.a、702.3.a）。
 * - "Spend my buff to [Stun] an enemy unit" / "Spend my buff to ready me"：
 *   "[do X] to [do Y]" 是**指令内费用**（355.10.c.1 / 404.1.b.1），费用未支付时 Y 不得结算。
 *   费用计划确实支持 spend-buff 支付（cost/plan-values.ts 与 cost/payment.ts 的
 *   spend-buff 分支，检查 Buff 数量并提交 spend-buff 动作），但没有把它作为“指令内费用”
 *   接进卡牌 body 的符号费用计划绑定与支付作用域；cost.pay 原语本身已合入。
 *   已合入的 effect.buff mode "spend" 只描述"消耗一个 Buff"这一动作，本身不是费用：
 *   按契约 3.4，negated 的指令其后续链接指令仍会尽可能执行，因此不能把
 *   `effect.buff(spend)` + linkedTo 当作"支付失败则不 Stun / 不 Ready"。
 *   不把 spend-buff 降级成普通 Might 修改（702.2.b.1 的"没有 Buff 就不能消耗"语义会丢失）。
 * - [Stun] 与 ready：424（Stunned 状态；424.1.a.1 已 Stunned 不再重复）与 416.1（Ready）；
 *   两者原语 effect.stun / effect.ready 已合入。
 *
 * 2026-10-17 再复核：整卡仍为 judge-required；当前缺口见 judgeReason。
 * 已合入原语与关键词声明不等于生产链路可执行；局部执行证据见同名单卡测试。
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
                    // "Spend my buff to ..." 的费用计划仍缺 body 绑定；
                    // 此处用已合入的 effect.buff mode "spend" 保留消耗结构，
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
    "「choose one that has not been chosen this turn」缺跨触发的每模式回合历史（CR 303、319）；choice.mode different 只约束单次选择，没有 choice.exclusive-once-per-turn 等价的历史消费。生产 Finalize 还缺 choice-plan adapter。" +
    "「Spend my buff to Stun/ready」是指令内费用（355.10.c.1、404.1.b.1）：现有 effect.buff spend + linkedTo 在无 Buff 时仍会执行后续，不能作为支付门控。" +
    "cost.pay、费用计划的 spend-buff 支付和 condition.result 均已合入；缺的是静态符号 self→运行时 Buff 费用计划的 body 绑定及 success-gated payment body/savepoint（203.3），并非 Buff 支付原语尚未实现。" +
    "object-exhausted 触发适配及 buff/stun/ready 子效果已有真实执行证据，不能把这些局部证据算作整卡执行。",
  abilities,
  sourceText:
    "When I become exhausted, choose one that hasn't been chosen this turn —\n" +
    "[Buff] me. (Give me a +1 :rb_might: buff if I don't have one.)" +
    "Spend my buff to [Stun] an enemy unit. (It doesn't deal combat damage this turn.)" +
    "Spend my buff to ready me."
} satisfies CardProgram;

export default program;
