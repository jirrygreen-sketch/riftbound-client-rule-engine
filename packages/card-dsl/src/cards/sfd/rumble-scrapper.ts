import type { CardProgram } from "../../ir/index.js";

/**
 * Rumble, Scrapper (sfd-089-221) — rumble-sfd (RIFT-95).
 *
 * "Your Mechs have +1 [M] (including me).
 *  When I hold, play a 3 [M] Mech unit token to your base."
 *
 * 规则依据（CR v1.5）：
 * - 「Your Mechs have +1 [M] (including me)」是静态算术层 Might 修改（478 / 478.1.a），
 *   由 continuous.might 承载（RIFT-258 的指令原语已合入，layers/engine.ts 的 arithmetic
 *   层能求值 amount/value 并做终值钳制）。
 * - 「When I hold」是 Hold Effect（383.4.d / 471.2 / 473.2.b）：封闭时点 hold 由已合入的
 *   回合/计分流程发出（turn/flow.ts 的 scheduleScore）。
 * - 「play a 3 [M] Mech unit token to your base」：Mech 是 CR 187.4 定义的 3 Might 单位 token，
 *   effect.token 的定义表 id 为 "mech"；440.2.c/185.2.a 的打出流程由 mode "play" 交付
 *   （链上生成后由 play 动作接手；合并内核实测可执行）。
 *
 * Production review（2026-10-21，RIFT-878 合入后重新实测）：
 * - CR v1.5 478.1.a：默认 static 绑定器把 { tags: ["Mech"], controller:
 *   "controller", zone: "board" } 注册到 arithmetic 层，controller 在求值时
 *   相对本能力来源解析；宿主自身也在「Your Mechs」集合内。
 * - CR 383.4.d.2.a / 473.2.b：TurnFlow 的 Beginning Phase Score wave 现在逐个
 *   发出当时在场 Unit 的精确 object/source/it，以及 details.battlefieldId/
 *   objectId/playerId；聚合 score 事件同时携带 participatingUnits。production
 *   绑定把 filter: { source: "self" } 译为 objectId，因此本卡的 hold 触发只在
 *   它自己位于被 Hold 的战场时命中，其他友方 Unit 的 Hold 不会误触发。
 * - CR 187.4 / 440.2.c / 185.2.a：触发正文先求值 ability-controller-base，
 *   再把该位置交给 effect.token 的 mech/play；生产 ChainEngine 真实 create-token、
 *   打出 3 Might Mech token，并把它放到能力控制者的 Base。
 */
export default {
  canonicalCardId: "card.hash-01bd7d3ff52eabd0afc59248a33845b648d9f61db8b544052f51057f967ceb7c",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "static",
      // “Your Mechs have +1 [M] (including me)” — the arithmetic-layer Might
      // modification registered by the merged continuous.might primitive; the
      // source itself is a Mech, so it is inside its own filter (478.1.a).
      effect: {
        kind: "continuous.might",
        // The default static binder translates tag -> tags and resolves
        // controller relative to the aura source before layer evaluation.
        filter: { tags: ["Mech"], controller: "controller", zone: "board" },
        value: { kind: "constant", value: 1 }
      }
    },
    {
      kind: "triggered",
      // “When I hold” — a Hold Effect (383.4.d, 471.2, 473.2.b) at the closed
      // `hold` timing point; the trigger points at this card through the
      // source anchor, which the merged programs layer translates to objectId.
      trigger: {
        at: "hold",
        filter: {
          // 封闭事件词表（events/trigger-spec.ts 的 EVENT_PATTERN_TYPES）用 "held"；
          // events/pipeline-match.ts 的 EVENT_NAMES 将其映射到 hold 时点。
          event: "held",
          filter: { source: "self" }
        }
      },
      optional: false,
      body: [
        {
          id: "rumble-scrapper.base",
          op: "condition.value",
          args: {
            // CR 191.5.a/.b: resolve the ability controller's Base, independently
            // of subsequent control changes to the ability's source.
            // effect.token accepts linked Expr values, not a relative player
            // name inside a literal LocationRef.
            value: { kind: "location", value: "ability-controller-base" }
          }
        },
        {
          id: "play-mech-token",
          // “play a 3 [M] Mech unit token to your base” — the printed Mech
          // token definition (187.4) played through the chain-creation path
          // (440.2.c / 185.2.a) to the controller's base.
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "mech" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: { kind: "linked-value", instructionId: "rumble-scrapper.base", key: "value" }
          }
        }
      ]
    }
  ],
  sourceText:
    "Your Mechs have +1 :rb_might: (including me).\nWhen I hold, play a 3 :rb_might: Mech unit token to your base."
} satisfies CardProgram;
