import type { CardProgram } from "../../ir/index.js";

/**
 * Minotaur Reckoner (sfd-014-221) — Unit.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, verbatim):
 *   "Units can't move to base."
 *
 * CR v1.5 anchors:
 * - 054/054.1: "Can't beats Can" — this is a global prohibition, never a
 *   permission (addsPermission stays false).
 * - 144.4.b: the Standard Move's Battlefield→Base route is removed for every
 *   unit; an effect move to a Base is likewise forbidden (451.1).
 *
 * Status: judge-required (re-checked 2026-10-17 by RIFT-667). The IR now
 * declares BOTH restriction spellings — the rule query (layers/rules/query.ts
 * movement()) reads the normalized plural `restrictions`, while the layer
 * snapshot (layers/engine.ts applyAbility) folds the singular `restriction` —
 * matching the merged convention on ogn/vilemaws-lair and unl/determined-sentry.
 * Measured after that fix: the production static binder registers the ability and
 * movement() really returns ["move-to-base"], so Standard Move validation
 * consumes the prohibition whenever a rules context is supplied.
 * One production gap remains:
 * - zones/movement.ts consumes that rule query, but no production caller passes
 *   DuelMovementRuleContext: standard-move-executor-v2.ts calls
 *   moveDuelUnitsWithMetadata without `rules`, so the default lifecycle still
 *   moves a unit from a battlefield to its base (CR 054.1/144.4.b/451.1), and
 *   effect.move never consults the query at all.
 * The IR and filtered object shape remain covered below, and the template golden
 * test/cards/templates/static-667.test.mjs holds the execution evidence.
 */
export default {
  canonicalCardId: "card.hash-4707dc730254c2d3c4ed3484a961094d03925ec45f647f561ff4b106e7e22ebe",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "RIFT-667 复核：IR 已同时声明复数 restrictions（layers/rules/query.ts 的 movement() 读取）与单数 restriction" +
    "（layers/engine.ts 的 applyAbility 折叠），与已合入的 ogn/vilemaws-lair、unl/determined-sentry 同形；" +
    "实测经生产 static binder 注册后 movement() 真的返回 [\"move-to-base\"]，Standard Move 校验在提供规则上下文时消费该禁止。" +
    "仍缺的生产消费方：没有任何调用方给 moveDuelUnitsStandard 提供 DuelMovementRuleContext——" +
    "duel/standard-move-executor-v2.ts 调 moveDuelUnitsWithMetadata 时不传 rules，" +
    "默认生命周期仍允许单位从战场移到基地（CR 054.1/144.4.b/451.1）；effect.move 也完全不查询该规则。" +
    "依赖：标准移动生产路径提供移动规则上下文，并让 effect.move 消费同一查询。不近似实现。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.movement",
        // 054.1: the prohibition only removes the option; it grants nothing.
        restriction: "move-to-base",
        // 规则查询 (layers/rules/query.ts movement()) 读复数；图层快照
        // (layers/engine.ts applyAbility) 读单数。两处都写，避免任一路径静默丢
        // 掉本卡的禁止（ogn/vilemaws-lair 的已合入同形写法）。
        restrictions: ["move-to-base"],
        addsPermission: false,
        // 053.2: the text names no host, so every unit on the board is covered.
        filter: { type: "unit", zone: "board" }
      }
    }
  ],
  sourceText: "Units can't move to base."
} satisfies CardProgram;
