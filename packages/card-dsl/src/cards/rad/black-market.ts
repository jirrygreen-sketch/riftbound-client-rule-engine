import type { CardProgram } from "../../ir/index.js";

/**
 * Black Market (rad-158-167) — Battlefield (domainless, RAD).
 *
 * Printed text:
 *   :rb_rune_rainbow::rb_rune_rainbow:: Draw 1. Each player may use this
 *   ability once on their turn (even if they don't control this battlefield).
 *
 * Rules evidence (Core Rules v1.5):
 * - 377.1: an activated ability is recognized by the ":" separating a cost
 *   from its effect. The cost here is two [A] runes
 *   (135.2.e.5 / 135.2.e.5.a: [A] Power can be paid by Power of any Domain),
 *   and the effect is "Draw 1" (414.1 / 414.3).
 * - 378 / 381: the ability belongs to a Battlefield; the Battlefield's
 *   controller decides when to activate it, and 378.2 / 381.3 cover abilities
 *   that one or more players other than the controller may activate, which is
 *   what "Each player may use this ability ... (even if they don't control
 *   this battlefield)" prints. The ChainEngine owns the timing check (canAct);
 *   this program only declares the speed.
 * - 377.2.b / 054.2: a condition on "using" an activated ability ("once on
 *   their turn") must be true in order to activate it, so it is a usage limit
 *   on the activation, not on the effect. 386's "once each turn" family
 *   explicitly covers only Replacement Effects, Passive Abilities and
 *   Triggered Abilities, so it cannot be borrowed for this Activated Ability.
 *
 * Status: judge-required. Re-checked against the merged surface; both gaps remain:
 * - The ability may be activated by ANY player, not only by the Battlefield's
 *   controller (378.2 / 381.3). Neither Ability nor CostSpec nor TargetSpec
 *   carries a per-activator permission or source-controller override. Declaring
 *   an activated ability would silently restrict it to the Battlefield's
 *   controller.
 * - The "once on their turn" usage limit (377.2.b / 054.2) has no merged
 *   consumer: Restriction is a kind-tagged free-form object but nothing reads a
 *   usage limit yet (the merged continuous.restrict op scope is play/move/
 *   target prohibitions, not activation frequency), trigger.once is a trigger
 *   lifetime, and chain Finalize only tests the conditions a caller supplies.
 * - The production activation command (apps/game-server .../runtime.ts) calls
 *   assertCanControl, so a non-controller is refused before the chain is
 *   reached; the merged scenario harness can pass the activator through, but
 *   the printed per-activator permission is not modeled anywhere.
 * The cost (two [A] runes) and the "Draw 1" body use merged primitives and are
 * executed by the golden test; activation permission and usage accounting stay
 * judge-required.
 */
export default {
  canonicalCardId: "card.hash-886b8c03b5b72474abc834112983d7b6adab55b1a3525aeddd44a39898736bb3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Each player may use this ability once on their turn (even if they don't control this battlefield)」缺两类支撑：" +
    "（1）378.2 / 381.3 允许非控制者启动的激活许可——activated 能力只由来源控制者启动，" +
    "activated 能力的启动草案没有「按启动者授予许可」字段，无法把来源控制者以外的玩家纳入合法启动者：" +
    "服务端 activate 命令（apps/game-server/src/engine-runtime/runtime.ts）在 describeActivate 之前调用 assertCanControl，" +
    "非控制者直接被拒；" +
    "（2）「once on their turn」是按启动者计的一次/回合使用上限：Restriction 目前只是开放的 kind 标签，" +
    "没有已合入的消费者（continuous.restrict 覆盖 play/move/target 类禁止，不是启动频度），" +
    "trigger.once 属触发生命周期、386 的 once each turn 家族只覆盖 Replacement/Passive/Triggered 而不能借用" +
    "（377.2.b 的\"使用条件\"需在启动前为真，054.2 的 only 门也一样）。" +
    "效果本体（2 个 [A] 符文费用 + Draw 1，377.1 / 135.2.e.5.a / 414.3）已按 3.1 声明，" +
    "并由 RIFT-689 参数化 golden 经真实链执行（test/cards/templates/activated-activated-effect-draw-689.test.mjs）；" +
    "当前缺口是按启动者授予许可，以及按启动者分别记录本回合是否已使用；不近似实现。",
  sourceText:
    ":rb_rune_rainbow::rb_rune_rainbow:: Draw 1. Each player may use this ability once on their turn (even if they don't control this battlefield).",
  abilities: [
    {
      kind: "activated",
      timing: "action",
      cost: {
        kind: "activated",
        // ":rb_rune_rainbow::rb_rune_rainbow:" — two [A] runes (135.2.e.5);
        // [A] can be paid with Power of any Domain (135.2.e.5.a), which is the
        // all-six-domain requirement accepted by the merged cost planner.
        payments: [
          {
            kind: "power",
            amount: { kind: "constant", value: 2 },
            allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]
          }
        ]
      },
      restriction: {
        // "Each player may use this ability once on their turn (even if they
        // don't control this battlefield)": the any-player permission
        // (378.2 / 381.3) and the per-activator once-per-turn limit
        // (377.2.b / 054.2) are recorded here for the pending
        // activation-permission / usage-limit layer; no merged consumer
        // resolves them.
        kind: "usage-limit",
        scope: "once-per-turn-per-player",
        activator: "any-player",
        ignoresControl: true
      },
      body: [
        {
          // "Draw 1." — one draw for the activating player (414.1 / 414.3).
          // effect.draw defaults to the ability controller, which is the
          // activator when the any-player permission lands.
          id: "black-market.draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ]
} satisfies CardProgram;
