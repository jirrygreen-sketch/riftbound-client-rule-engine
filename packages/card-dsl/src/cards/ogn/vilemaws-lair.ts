import type { CardProgram } from "../../ir/index.js";

/**
 * Vilemaw's Lair (ogn-295-298) — Battlefield, Colorless.
 *
 * sourceText: Units can't move from here to base.
 *
 * CR v1.5 anchors:
 * - 054 / 054.1: "Can't beats Can" — this is a prohibition that beats the Move
 *   permissions granted by cards (the rules use exactly this Battlefield as the
 *   example: 358.3.a, 359.3.e.14.b — Ride the Wind is legal to play, but the
 *   move instruction is negated on resolution while the ready instruction still
 *   executes).
 * - 421.1 / 449: a move between two Board locations; 144.4.b defines the
 *   Battlefield→Base Standard Move this restriction removes.
 * - 053.3: "here" is this Battlefield.
 *
 * Status: judge-required. The ability is a passive movement restriction with no
 * chain interaction. Re-checked against the merged code: the continuous.movement
 * instruction primitive (RIFT-259), the layer engine's restriction recording and
 * the layers/rules/query `movement()` reader all exist, but the card still cannot
 * execute as a whole:
 * - the primitive + query are not wired to card data: no merged path turns a
 *   CardProgram's static ability into a ContinuousEffectSpec registration
 *   (card-program binding, RIFT-257). Only trusted instruction callers register
 *   effects today;
 * - zones/movement.ts validates Standard Moves from its own explicit
 *   DuelStandardMoveTiming/DuelBoard inputs and never reads the layers
 *   MovementPermissions, so even a registered restriction cannot negate the
 *   Standard Move (144.4.b);
 * - effect.move documents that path restrictions and the corrective Recall are
 *   move-location's concern, and effect.move has no hook for continuous
 *   movement restrictions either, so the 358.3.a/359.3.e.14.b expectation is
 *   still unproduced;
 * - layers/filter.ts implements no sameLocationAs anchor (verified: a filter
 *   with sameLocationAs matches an object at any location), so "here" would
 *   attach the restriction to units at every Battlefield once a producer lands.
 * The golden tests exercise the real primitive registration and the real
 * `movement()` query against the declared restriction; the missing consumer
 * stays a test.todo, not an approximation.
 */
export default {
  canonicalCardId: "card.hash-3e2d969f2528a782a98c698fc45d9937d376dd06244c444271adf9cbd4100e77",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「Units can't move from here to base.」是 054/054.1 的禁止型移动限制（358.3.a、359.3.e.14.b 正好以本战场为例）：该限制要覆盖 144.4.b 的 " +
    "Battlefield→Base Standard Move 与效果移动。复核合并代码：continuous.movement 指令（RIFT-259）、图层记录（ObjectSnapshot.movement.restrictions）" +
    "与 layers/rules/query 的 movement() 读取入口都已合入，但整卡仍不可执行：① 没有路径把 CardProgram 的 static 能力注册成 ContinuousEffectSpec" +
    "（卡牌程序绑定 RIFT-257，目前只有可信指令调用方能注册）；② zones/movement.ts 只按自己的 DuelStandardMoveTiming / DuelBoard 输入校验 Standard Move，" +
    "从不读图层 MovementPermissions，注册后也无法否定移动；③ effect.move 文档明确路径限制与矫正 Recall 归 move-location，而 move-location / " +
    "effect.move 都没有读持续移动限制的接口（358.3.a/359.3.e.14.b 的期望仍未产出）；④ layers/filter.ts 不实现 sameLocationAs 锚点" +
    "（实测带 sameLocationAs 的过滤会匹配任意位置的单位），「here」会落到任意战场的单位上。" +
    "依赖：RIFT-257（CardProgram 绑定）与 zones/movement 的移动限制消费方。不近似实现（不把限制改写成一个假的 negated 占位指令）。",
  sourceText: "Units can't move from here to base.",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.movement",
        restriction: "move-from-here-to-base",
        // 054.1: a prohibition; it removes the 144.4.b option and never grants
        // one. The merged layers loader records the restriction string on the
        // filtered objects' movement permissions (see judgeReason for the
        // missing consumer).
        addsPermission: false,
        filter: {
          type: "unit",
          zone: "board",
          sameLocationAs: "self"
        }
      }
    }
  ]
} satisfies CardProgram;
