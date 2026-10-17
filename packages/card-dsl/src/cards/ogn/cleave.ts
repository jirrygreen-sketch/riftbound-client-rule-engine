import type { CardProgram } from "../../ir/index.js";

/**
 * Cleave (ogn-004-298) — Spell, 1 Energy, Fury.
 *
 * Printed text:
 *   [Action] (Play on your turn or in showdowns.)
 *   Give a unit [Assault 3] this turn. (+3 :rb_might: while it's an attacker.)
 *
 * Catalog evidence (packages/card-data/data/deck-catalog.json, dataVersion
 * 2026-10-12-official-gallery): energy 1, power null (no printed Power), might
 * null, tags [].
 *
 * Status: judge-required.
 * - "Give a unit [Assault 3] this turn" is a duration-bounded keyword grant and
 *   the merged `continuous.grant-keyword` instruction registers it:
 *   the op resolves the selected unit and calls ResolveContext.addContinuous
 *   with an ability-layer keyword effect carrying the printed value 3, with the
 *   alias duration "end-of-turn" resolved for "this turn" (317.1.a/317.2.c/
 *   468.7.c; layers/ops `resolveContinuousDuration`) — executed by the golden.
 * - "a unit" names one game object on the Board and is a Choice, so it is a
 *   TargetSpec (355.5/355.7/355.9.a.1), not a pick; the target is read through
 *   the merged target system and revalidated at Resolve.
 * - The granted Assault's functional text (+3 Might while the host is an
 *   attacker, CR 807.1.c/807.2) still has no executable consumer: the Assault
 *   KeywordDef exists, but the granted keyword is not automatically sent through
 *   its KeywordDef expansion, the attacker designation is not part of the layers
 *   ObjectSnapshot, and layers/engine.ts conditionMatches does not evaluate the
 *   `compare` condition the expansion carries, so the bonus would either never
 *   apply or apply unconditionally. The card therefore stays judge-required.
 * - A Buff counter (CR 702) is a different object state, so nothing is
 *   approximated through effect.buff.
 */
const cleave = {
  canonicalCardId: "card.hash-e946abd159c3e001431a6266172cc524d41158117457180e81e85ef7690a4354",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "关键词授予原语已合入并可执行（continuous.grant-keyword；golden 已真实注册 ability 层 " +
    "Assault 3 与 end-of-turn 期限），但被授予 Assault 的功能文本「+3 :rb_might: while it's an attacker」" +
    "（807.1.c/807.2）仍没有可执行消费链：Assault 的 KeywordDef 展开是条件于宿主 attacker designation 的 " +
    "continuous.might，而 (1) 授予的关键词不会自动再次进入 KeywordDef.expand，" +
    "(2) designation 不在 layers 的 ObjectSnapshot 特征里，(3) layers/engine.ts 的 conditionMatches 不求解 " +
    "compare 条件（未知 kind 一律按 true），该条件在真实图层计算里既不能生效也不能正确关闭。" +
    "依赖：授予关键词二次展开、designation 谓词与 compare 条件消费方。不近似实现（不用 Buff 计数代替 Might 修改）。",
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Give a unit [Assault 3] this turn. (+3 :rb_might: while it's an attacker.)",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      // Printed cost is 1 Energy; this printing has no Power value (null in the
      // catalog), so no Power component is declared. null is never rewritten
      // as 0.
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 1 }
      },
      body: [
        {
          // The granted keyword, its value and the end-of-turn duration are
          // submitted through the merged continuous.grant-keyword primitive;
          // the selected unit is read with the target selector.
          id: "cleave.grant-assault-3",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Assault" },
            value: { kind: "constant", value: 3 },
            duration: { kind: "constant", value: "end-of-turn" },
            // 355.10.d / 契约 3.6：目标由已 Finalize 锁定的 TargetSpec 读取。
            objects: { kind: "constant", value: { kind: "target", id: "cleave.unit" } }
          },
          targets: [
            {
              id: "cleave.unit",
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;

export default cleave;
