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
 * Current review:
 * CR v1.5 478.1.a: the friendly Mech +1 Might aura can be registered
 * through the default static binder, including the host.
 * CR 383.4.d/471.2/473.2.b: Hold must match this unit's battlefield when
 * the point is gained. The event currently carries player/battlefieldId only.
 * The token body binds its relative Base location before primitive dispatch.
 * CR 187.4/440.2.c/185.2.a: the body plays a 3-Might Mech token to your Base.
 */
export default {
  canonicalCardId: "card.hash-01bd7d3ff52eabd0afc59248a33845b648d9f61db8b544052f51057f967ceb7c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「When I hold」仍缺 CR v1.5 383.4.d、471.2、473.2.b 的宿主—被 Hold 战场匹配：turn/flow.ts 只发 player/details.battlefieldId，未带本单位 object；当前 translateTriggerFilter 将 source:self 译成 objectId，events/pipeline-match.ts 无法据此命中，且缺在得点时对宿主所在战场的校验。第一条 continuous.might 光环的默认 static 注册、tag→tags 及 controller→来源控制者绑定均已存在；effect.token 的 mech/play 子效果通过 condition.value + location 表达式绑定能力控制者基地，再以 linked-value 交给原语，可真实执行。依赖：Hold 事件的来源位置条件与触发绑定；不把所有己方 Hold 或无关单位的 Hold 当作本单位 Hold。",
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
        filter: { tag: "Mech", controller: "controller", zone: "board" },
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
          event: "hold",
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
