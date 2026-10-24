import type { CardProgram } from "../../ir/index.js";

/**
 * Assembly Rig (sfd-019-221) — Rumble SFD Gear.
 *
 * Printed text: ":rb_energy_1::rb_rune_fury:, Recycle a unit from your trash,
 * :rb_exhaust:: Play a 3 :rb_might: Mech unit token to your base."
 *
 * One activated ability (action timing; Gear abilities default to action
 * speed). CostSpec is data-only per contract 3.1: energy 1 plus one Fury
 * power (RIFT-9 cost.pay), the "Recycle a unit from your trash" cost is the
 * targeted recycle form backed by effect.recycle (CR 417.6), and the exhaust
 * symbol is the exhaust payment kind. Cost payment is checked at Finalize by
 * the chain (contract 3.2 / 3.5).
 *
 * Body: the printed token is the frozen CR 187.4 Mech definition (3 Might,
 * no abilities). "Play" is effect.token's mode "play": the token is created
 * on the Chain and that exact ObjectRef is handed to the ordinary Play
 * process (CR 350.2, 440.2.c, 185.2.a, 354). The concrete destination is the
 * controller's Base; resolving that selector there avoids treating the
 * symbolic "controller" as a player id. The Unit enters exhausted under CR
 * 143.4 / 185.2.d. No abilities are invented for the token.
 *
 * Status is judge-required because the production Chain currently performs
 * that Play synchronously inside the activated ability's Resolve. The token
 * is momentarily created on the Chain, but it enters the Board before any
 * Pending/Finalized token item appears. The authored IR is the correct printed
 * behavior; this status records the engine gap rather than claiming the full
 * card works.
 */
export default {
  canonicalCardId: "card.hash-d490b51d08bdd7f97b1708aabfa6309995106f10de815b6fd927368e4a630569",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "生产链尚不能把本卡的 token Play 建成独立链项：effect.token 在 " +
    "engine-core/src/effects/instructions/effect.token.ts:380-408 已发起 " +
    "create-token(to: \"chain\") 与 play；两者都经 ChainEngine.commit 与 " +
    "pipeline.routeAction/appendCard（chain/engine.ts:514-533）建立链项。问题在嵌套时机：" +
    "父 activation 的 resolve() 尚未返回时，advance()（chain/engine.ts:1689-1705）会取到并 Finalize 刚建立的 token " +
    "链项，使 token 在父 Resolve 内同步入场。实测事件仅出现 object-enters-chain、" +
    "object-enters-board，不出现该 token 独立的 chain-item-pending/chain-item-finalize。" +
    "CR 350.2、440.2.c、354 要求先创建为 token 的 Play 链项；CR 143.4/185.2.d 还要求" +
    "其 Unit 入场横置。费用、回收、Exhaust 与最终 3-Might 横置 Mech 已走生产路径验证；" +
    "缺失能力应让 token Play 在父 activation Resolve 后成为独立 Pending 项，再经 " +
    "Finalize/Resolve 入 Base，不得用同步 create-to-board 近似。",
  abilities: [
    {
      kind: "activated",
      cost: {
        energy: { kind: "constant", value: 1 },
        power: { kind: "constant", value: ["Fury"] },
        payments: [
          {
            kind: "recycle",
            choice: {
              id: "recycled-unit",
              options: ["unit-in-controller-trash"],
              min: 1,
              max: 1,
              selection: "one",
              zone: "trash",
              type: "unit",
              owner: "controller"
            }
          },
          { kind: "exhaust" }
        ]
      },
      timing: "action",
      body: [
        {
          id: "create-mech-token",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "mech" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: {
              kind: "constant",
              value: { type: "base", player: "controller" }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    ":rb_energy_1::rb_rune_fury:, Recycle a unit from your trash, :rb_exhaust:: Play a 3 :rb_might: Mech unit token to your base."
} satisfies CardProgram;
