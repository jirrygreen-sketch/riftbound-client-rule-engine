import type { CardProgram } from "../../ir/index.js";

/**
 * Sunlit Guardian (ogn-054-298) — Unit, 3 energy, Might 3, Calm, Shurima.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-054-298):
 *   [Shield] (+1 :rb_might: while I'm a defender.)
 *   [Tank] (I must be assigned combat damage first.)
 *
 * Both abilities are keyword declarations (contract 3.1 / 3.7): the card only
 * names shield and tank, and the reminder text is the printed explanation of
 * the keyword, not a separate instruction.
 *
 * Status: judge-required. Neither keyword can be executed by the merged code:
 * - [Shield] (814) is printed without a value, so X is presumed 1
 *   (814.1.b.3) and it is functionally "while I am a defender, I have +1 [M]"
 *   (814.1.c). effects/keywords/Shield.ts exists and expands to a static
 *   `continuous.might` ability gated on the defender designation
 *   (814.1.d/814.1.d.1), but (a) no merged code turns a card program or a
 *   KeywordDef expansion into a registered continuous effect, so the layers
 *   engine never sees it (RIFT-91), (b) the defender designation is not a
 *   merged ObjectSnapshot characteristic — contract 3.8 adds `combatRole`, and
 *   engine-core's effects/contract.ts still has no such field, and (c) the
 *   layers engine does not evaluate a `compare` condition (badly, it would
 *   apply the +1 unconditionally).
 * - [Tank] (815) has no KeywordDef at all (effects/keywords/ contains no
 *   Tank.ts) and the merged combat allocation binds no assignment-priority
 *   requirement (combat/base-combat-allocation.ts: "No Tank/Backline/other
 *   assignment-priority requirement is bound here"), so 815.1.b / 815.1.c.2
 *   cannot be executed. Not approximated.
 */
export default {
  canonicalCardId: "card.hash-0386094f508d9cbd2f5fca31e0757380fa1c42cf0e9124b48b8a32d75b9fddc4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Shield]（814）不可执行：印刷省略数值按 814.1.b.3 取 X=1，功能上是「守护者身份 +1 [M]」（814.1.c/814.1.d.1），" +
    "effects/keywords/Shield.ts 的展开依赖防守者身份（designation）——契约 3.8 的 ObjectSnapshot.combatRole 尚未进入 engine-core 的 effects/contract.ts，" +
    "且没有任何合入路径把卡牌程序/关键词展开注册进 layers（RIFT-91），层引擎也不求值 compare 条件；" +
    "[Tank]（815）连 KeywordDef 都没有（effects/keywords/ 无 Tank.ts），战斗伤害分配也未绑定分配优先要求" +
    "（combat/base-combat-allocation.ts 明确不绑定 assignment-priority），815.1.b/815.1.c.2 不可执行。" +
    "依赖：RIFT-91（layers-continuous + combatRole 落地）、关键词注册表（Tank KeywordDef）与 combat 分配批次。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "shield" },
    { kind: "keyword", keyword: "tank" }
  ],
  sourceText:
    "[Shield] (+1 :rb_might: while I'm a defender.)\n" +
    "[Tank] (I must be assigned combat damage first.)"
} satisfies CardProgram;
