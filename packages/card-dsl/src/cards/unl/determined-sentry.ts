import type { CardProgram } from "../../ir/index.js";

/**
 * Determined Sentry (unl-111-219) — Unit, Body, Yordle/Bandle City;
 * energy 1, Might 1.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-111-219, verbatim):
 *   I can't move to base.
 *
 * Rules evidence (Core Rules v1.5):
 * - 054 / 054.1: "Can't beats Can" — this is a prohibition on the host, not a
 *   permission; it removes the Battlefield→Base option of 144.4.b for this unit
 *   and also forbids an effect Move to its Base (451.1: the source of the Move
 *   supplies destination restrictions).
 * - 421.1 / 448 / 449: a Move between two Board locations; 144.4.b is the
 *   Standard Move option it removes. 053.1: "I" is the ability host.
 * - Contract 3.4 / layers: a passive prohibition is a continuous effect in the
 *   ability layer; the merged LayerEngine records `continuous.movement`
 *   restriction strings on the filtered object's MovementPermissions.
 *
 * Status: judge-required (re-reviewed for RIFT-329), matching ogn/vilemaws-lair
 * (the same prohibition on a Battlefield) and ogn/noxus-saboteur:
 * - the merged layer engine records the restriction (continuous.movement is a
 *   registered primitive and layers/engine.ts writes it into the object's
 *   MovementPermissions), but nothing consumes it: the rules query layer
 *   (layers/rules/query.ts movement()) is a standalone API with no production
 *   caller — zones/movement.ts validates Standard Moves from its own timing and
 *   DuelBoard inputs and never reads MovementPermissions, and effect.move
 *   documents that path restrictions belong to move-location, which has no
 *   continuous-restriction hook either, so a recorded restriction cannot negate
 *   the move;
 * - no merged producer registers this CardProgram's static ability as a
 *   ContinuousEffectSpec in the first place: the only registration entry points
 *   are resolving continuous.* instructions and keyword expansion
 *   (layers/engine.ts registerContinuousEffect has no caller,
 *   programs/statics.ts bindStatic is only exercised by tests).
 * The ability stays a passive movement restriction; it is not rewritten into a
 * fake negated placeholder instruction.
 */
export default {
  canonicalCardId: "card.hash-1fdab35e21db7372013c7ccc1c69b1ebf752b66cdac3f9cef733a8a4619b112b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「I can't move to base」是 054/054.1 的禁止型移动限制：它移除 144.4.b 的本单位战场→基地选项，" +
    "并同样禁止效果移动把本单位送往基地（451.1）。已合入的 layers/LayerEngine 能把 continuous.movement 的 restriction " +
    "写进对象的 MovementPermissions（ogn/vilemaws-lair 的用例已证明），但没有任何生产消费方：① 图层侧只有 layers/rules/query.ts 的 " +
    "movement() 独立查询 API，没有调用方；② zones/movement.ts 只按自己的 DuelStandardMoveTiming / DuelBoard 输入校验 Standard Move，" +
    "从不读 MovementPermissions；③ effect.move 文档明确路径限制归 move-location，而 move-location 也没有读取持续限制的接口——登记后仍无法否定移动。" +
    "另外没有已合入路径把 CardProgram 的 static 能力注册成 ContinuousEffectSpec：唯一入口是结算中的 continuous.* 指令与关键词展开" +
    "（layers/engine.ts 的 registerContinuousEffect 无调用方，programs/statics.ts 的 bindStatic 只有测试 binder）。" +
    "依赖：卡牌 static 注册（RIFT-91 后续）与移动限制消费任务（zones/movement 与 move-location 的接入）。不近似实现。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.movement",
        // 054.1：禁止只移除选项、不授予任何许可。
        restriction: "move-to-base",
        addsPermission: false,
        filter: { object: "self" }
      }
    }
  ],
  sourceText: "I can't move to base."
} satisfies CardProgram;
