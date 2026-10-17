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
 * Status: judge-required. Both KeywordDefs are now merged (RIFT-81/RIFT-264),
 * but neither expansion has a runtime consumer:
 * - [Shield] (814) is printed without a value, so X is presumed 1 (814.1.b.3)
 *   and it is functionally "while I am a defender, I have +1 [M]" (814.1.c).
 *   effects/keywords/Shield.ts expands to a static `continuous.might` ability
 *   gated on the defender designation (814.1.d/814.1.d.1), but (a) no merged
 *   path registers a card program's keyword expansion into the layers
 *   registration (RIFT-257), (b) the defender designation is not a merged
 *   ObjectSnapshot characteristic — contract 3.8 adds `combatRole`, and
 *   engine-core's effects/contract.ts still has no such field, and (c) the
 *   layers engine does not evaluate a `compare` condition (conditionMatches
 *   only knows always/never/type/has-tag/has-keyword and treats anything else
 *   as true), so registering it would apply the +1 unconditionally.
 * - [Tank] (815) now expands to a continuous.combat damage-assignment
 *   declaration (RIFT-264), but that kind has no layers branch and the merged
 *   combat allocation binds no assignment-priority requirement
 *   (combat/base-combat-allocation.ts: "No Tank/Backline/other
 *   assignment-priority requirement is bound here"), so 815.1.b / 815.1.c.2
 *   cannot be executed. Not approximated.
 */
export default {
  canonicalCardId: "card.hash-0386094f508d9cbd2f5fca31e0757380fa1c42cf0e9124b48b8a32d75b9fddc4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两个 KeywordDef 都已合入（Shield RIFT-81、Tank RIFT-264），但展开都没有运行时消费路径：" +
    "(1) [Shield]（814）印刷省略数值按 814.1.b.3 取 X=1，功能上是「守护者身份 +1 [M]」（814.1.c/814.1.d.1），" +
    "展开依赖防守者 designation——契约 3.8 的 ObjectSnapshot.combatRole 尚未进入 engine-core 的 effects/contract.ts，" +
    "layers/engine.ts 的 conditionMatches 也不求值 compare 条件（只认 always/never/type/has-tag/has-keyword，其余恒真），" +
    "直接注册会变成常驻；且没有合入路径把卡牌程序的关键词展开注册进 layers（RIFT-257）。" +
    "(2) [Tank]（815）展开为 continuous.combat（mode damage-assignment/priority first），该 kind 没有图层分支，" +
    "战斗伤害分配也未绑定分配优先要求（combat/base-combat-allocation.ts 明确不绑定 assignment-priority），815.1.b/815.1.c.2 不可执行。" +
    "依赖：RIFT-257（关键词展开注册）、combatRole/designation 特性和图层 compare 求值（RIFT-91/258 后续）与战斗分配优先级绑定。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "shield" },
    { kind: "keyword", keyword: "tank" }
  ],
  sourceText:
    "[Shield] (+1 :rb_might: while I'm a defender.)\n" +
    "[Tank] (I must be assigned combat damage first.)"
} satisfies CardProgram;
