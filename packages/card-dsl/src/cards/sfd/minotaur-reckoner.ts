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
 * Status: judge-required (re-checked 2026-10-17). Two current gaps remain:
 * - The generic static CardProgram binder (programs/statics.ts) registers the
 *   ability, but it preserves the continuous.movement instruction's singular
 *   `restriction` field, while the movement() rule query
 *   (layers/rules/query.ts) reads the normalized plural `restrictions`. The layer
 *   snapshot path does fold the singular field into
 *   ObjectSnapshot.movement.restrictions, so only the rule-query path is broken.
 * - zones/movement.ts consumes that rule query, but no production caller passes
 *   DuelMovementRuleContext: standard-move-executor-v2.ts calls
 *   moveDuelUnitsWithMetadata without `rules`, so even a normalized restriction
 *   would not gate the Standard Move. CR 054.1/144.4.b still therefore cannot be
 *   enforced through the default lifecycle path.
 * The IR and filtered object shape remain covered below.
 */
export default {
  canonicalCardId: "card.hash-4707dc730254c2d3c4ed3484a961094d03925ec45f647f561ff4b106e7e22ebe",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处当前缺口：(1) 通用 CardProgram static binder（programs/statics.ts）已合入并会注册本能力，" +
    "但注册保留 continuous.movement 的单数 restriction 字段，而 movement() 规则查询" +
    "（layers/rules/query.ts）读规范化后的复数 restrictions，默认绑定没有做该归一化；" +
    "层引擎快照（layers/engine.ts）会把单数字段折进 ObjectSnapshot.movement.restrictions，" +
    "所以只有规则查询路径断开（已由 golden 直接证明 query 结果为 []，快照为 [\"move-to-base\"]）。" +
    "(2) zones/movement.ts 虽已消费该规则查询，但没有任何生产调用方提供 DuelMovementRuleContext：" +
    "duel/standard-move-executor-v2.ts 调 moveDuelUnitsWithMetadata 时不传 rules，" +
    "因此即便归一化修好，054.1/144.4.b 的「Units can't move to base」也不会经默认生命周期生效。" +
    "依赖：continuous.movement restriction/restrictions 的统一归一化，以及标准移动生产路径提供移动规则上下文。不近似实现。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.movement",
        // 054.1: the prohibition only removes the option; it grants nothing.
        restriction: "move-to-base",
        addsPermission: false,
        // 053.2: the text names no host, so every unit on the board is covered.
        filter: { type: "unit", zone: "board" }
      }
    }
  ],
  sourceText: "Units can't move to base."
} satisfies CardProgram;
