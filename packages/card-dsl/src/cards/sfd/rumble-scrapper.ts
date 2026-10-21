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
 * Current review（2026-10-17，对照已合入源码重新核实）:
 * - CR v1.5 478.1.a：友方 Mech +1 [M] 光环由默认 static 绑定器注册，包含宿主
 *   自身（createEngineStaticBinder → arithmetic 层）。
 * - CR 383.4.d/471.2/473.2.b：Hold Effect 仍无消费方。事件判别值必须写作封闭
 *   词表的 "held"（EVENT_PATTERN_TYPES；events/pipeline-match.ts 的 EVENT_NAMES
 *   把它映射到 hold 时点）。绑定层随后把 filter: { source: "self" } 译成
 *   object: { objectId: 本卡 }，而 turn/flow.ts 的 scheduleScore 只发
 *   { player, details: { battlefieldId } }：events/pipeline-match.ts 的
 *   matchesTriggerObject 对 undefined object 只在过滤器为空时命中，实测该 spec
 *   对真实 hold 发射恒不匹配，383.4.d.2.a 的「单位当时在场」与 473.2.b 的战场
 *   归属都无从判定。
 * - CR 187.4/440.2.c/185.2.a：effect.token 的 mech/play 子效果由 condition.value
 *   + location 表达式先绑定能力控制者基地，原语真实 create-token 后 play。
 */
export default {
  canonicalCardId: "card.hash-01bd7d3ff52eabd0afc59248a33845b648d9f61db8b544052f51057f967ceb7c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「When I hold」仍缺消费方：触发已在程序里写作封闭判别值 held（管线映射到 hold 时点），production 绑定后 spec 为 " +
    "{ at: \"hold\", filter: { event: \"held\", object: { objectId: <本卡> } } }，可注册但恒不命中——turn/flow.ts 的 scheduleScore " +
    "只发 { player, details: { battlefieldId } }，没有携带被固守战场上的单位，events/pipeline-match.ts 的 matchesTriggerObject 对 " +
    "undefined object 仅在过滤器为空时返回 true。因此 CR v1.5 383.4.d.2.a 的「本单位在 Hold 时在场」与 473.2.b 的按战场归属无法判定；" +
    "依赖 RIFT-120 后续（hold 发射补齐被固守对象或战场身份，使 source: self 锚点可判定；sfd/guardian-of-the-passage、" +
    "sfd/dunebreaker 同缺口，RIFT-120 仍未合入）。" +
    "第一条 continuous.might 光环的默认 static 注册、tag→tags 与 controller→来源控制者归一如实执行（golden 用生产绑定器断言只加友方 Mech）；" +
    "effect.token 的 mech/play 子效果经 condition.value + location 绑定能力控制者基地，再以 linked-value 交给原语，真实执行 create-token + play。" +
    "不把所有己方 Hold 或无关单位的 Hold 当作本单位 Hold。",
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
