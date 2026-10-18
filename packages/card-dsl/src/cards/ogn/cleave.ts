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
 *   attacker, CR 807.1.c/807.2) has no production consumer yet: the
 *   KeywordGrantLayerEngine re-expansion is merged (its environment aliases
 *   designation to combatRole), but production assembly still uses the plain
 *   LayerEngine and the designation/combatRole mapping is not wired outside
 *   that engine. The card therefore stays judge-required.
 * - A Buff counter (CR 702) is a different object state, so nothing is
 *   approximated through effect.buff.
 *
 * RIFT-681 execution evidence: the real play (1 Energy payment, the locked
 * board-unit target, the ability-layer Assault 3 registration) and the boundary
 * where no legal Board unit exists run through the generic card scenario harness in
 * test/cards/templates/keyword-play-continuous-grant-keyword-681.test.mjs. The
 * granted keyword's functional text stays the only gap, so the card remains
 * judge-required.
 */
const cleave = {
  canonicalCardId: "card.hash-e946abd159c3e001431a6266172cc524d41158117457180e81e85ef7690a4354",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "唯一未合入的依赖是被授予 Assault 的功能文本「+3 :rb_might: while it's an attacker」（807.1.c/807.1.d.1）：" +
    "continuous.grant-keyword 原语与整卡打出已可执行（模板化 golden 经通用测试台真实支付 1 能量、" +
    "锁定 Board 单位目标并在 ability 图层登记 Assault 3 + end-of-turn 期限）。" +
    "缺的是该登记关键词的生产消费链：KeywordGrantLayerEngine 的二次展开已合入（其环境把 designation 别名到 combatRole），" +
    "但生产装配仍用普通 LayerEngine，没有接入该引擎；Assault 展开读取 object-property(self, \"designation\")，" +
    "生产 ObjectSnapshot 只暴露 combatRole 且该映射没有生产产生方（combatRole 默认 null）。" +
    "依赖：授予关键词的 KeywordDef 二次展开与 designation/combatRole 对齐。" +
    "不近似实现（不用 Buff 计数代替条件 Might 修改）。",
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
