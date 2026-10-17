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
 * Status: judge-required (re-checked 2026-10-17 against the merged sources):
 * - the snapshot path (layers/engine.ts applyAbility) folds the singular
 *   `restriction` into ObjectSnapshot.movement.restrictions, while the rule
 *   query (layers/rules/query.ts movement()) reads the plural `restrictions`.
 *   The declaration therefore carries BOTH spellings, the merged shape used by
 *   ogn/vilemaws-lair: the query now really returns "move-to-base", so Standard
 *   Move validation sees the prohibition through the optional rules context.
 * - two production consumers are still missing: no caller supplies a
 *   DuelMovementRuleContext to moveDuelUnitsStandard (duel/standard-move-executor-v2.ts
 *   calls moveDuelUnitsWithMetadata without `rules`), and effect.move does not
 *   consult movement permissions/restrictions at all (CR 451.1). Until they
 *   land, the printed prohibition is declared but not enforced end to end.
 * The ability stays a passive movement restriction; it is not rewritten into a
 * fake negated placeholder instruction.
 */
export default {
  canonicalCardId: "card.hash-1fdab35e21db7372013c7ccc1c69b1ebf752b66cdac3f9cef733a8a4619b112b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「I can't move to base」是 054/054.1 的禁止型移动限制：它移除 144.4.b 的本单位战场→基地选项，" +
    "并同样禁止效果移动把本单位送往基地（451.1）。已核实并已修好的部分：静态程序 binder 能把 " +
    "continuous.movement 注册为 ContinuousEffectSpec，本卡现在同时声明复数 restrictions（规则查询 " +
    "layers/rules/query.ts movement() 读取）与单数 restriction（图层快照 layers/engine.ts applyAbility 折叠），" +
    "实测经过 production static binder 注册后，movement() 返回 restrictions: [\"move-to-base\"]，Standard Move 校验可消费。" +
    "仍缺两处生产消费方：(1) 没有调用方给 moveDuelUnitsStandard 提供 DuelMovementRuleContext——" +
    "duel/standard-move-executor-v2.ts 调 moveDuelUnitsWithMetadata 时不传 rules，默认生命周期仍不读取该查询；" +
    "(2) effect.move 完全不查询 movement 许可/禁止（451.1），效果移动可以无视本限制。依赖：标准移动生产路径提供" +
    "移动规则上下文，并让 effect.move 消费同一查询。不近似实现。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.movement",
        // 054.1：禁止只移除选项、不授予任何许可。
        restriction: "move-to-base",
        // 规则查询 (layers/rules/query.ts movement()) 读复数；图层快照
        // (layers/engine.ts applyAbility) 读单数。两处都写，避免任一路径静默丢
        // 掉本卡的禁止（ogn/vilemaws-lair 的已合入同形写法）。
        restrictions: ["move-to-base"],
        addsPermission: false,
        filter: { object: "self" }
      }
    }
  ],
  sourceText: "I can't move to base."
} satisfies CardProgram;
