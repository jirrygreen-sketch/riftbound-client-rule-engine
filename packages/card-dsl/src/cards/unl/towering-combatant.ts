import type { CardProgram } from "../../ir/index.js";

/**
 * Towering Combatant (unl-099-219) — Unit, Body, Shurima; energy 4, Might 3.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-099-219, verbatim):
 *   [Shield 2] (+2 :rb_might: while I'm a defender.)
 *   [Tank] (I must be assigned combat damage first.)
 *
 * Both abilities are keyword declarations only (contract 3.1 / 3.7 and README
 * §5): the reminder text belongs to the printed keyword, it is not a second
 * instruction to author here.
 *
 * Status: judge-required, matching ogn/sunlit-guardian and ogn/stormclaw-ursine:
 * - [Shield 2] (814.1.b / 814.1.b.1 / 814.1.b.2 / 814.1.c / 814.1.d.1) expands
 *   to a static continuous.might ability gated on the Defender designation
 *   (effects/keywords/Shield.ts is merged). Two merged pieces are still missing:
 *   (a) nothing registers a CardProgram keyword/static ability into the layers
 *   engine (RIFT-91 delivered the engine, not the card wiring); (b) the Defender
 *   designation is not a merged ObjectSnapshot characteristic (contract 3.8
 *   adds `combatRole`, engine-core's effects/contract.ts has no such field) and
 *   the layer engine's conditionMatches does not evaluate `compare`, so the +2
 *   cannot be limited to the defending state.
 * - [Tank] (815.1.b / 815.1.c.1 / 815.1.c.2) has no KeywordDef at all and the
 *   merged combat allocation binds no assignment-priority requirement for it
 *   (combat/base-combat-allocation.ts: "No Tank/Backline/other
 *   assignment-priority requirement is bound here").
 * Neither keyword is rewritten as static numbers or instructions.
 */
export default {
  canonicalCardId: "card.hash-954548f2a1317ac2bc2954489da0730ecf613acc22887c0dc6c46d250c025391",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Shield 2]（814）的展开文件已合入（effects/keywords/Shield.ts → 防守者身份 +2 Might 的 static " +
    "continuous.might），但没有已合入路径把 CardProgram 的关键词/static 能力注册进 layers（RIFT-91 只交付图层引擎），" +
    "且 Defender designation 尚不是 ObjectSnapshot 特征（契约 3.8 的 combatRole 未进入 effects/contract.ts），" +
    "层引擎 conditionMatches 也不求值 compare——无法把 +2 限制在防守状态；" +
    "[Tank]（815）没有 KeywordDef 文件，战斗伤害分配也未绑定分配优先要求" +
    "（combat/base-combat-allocation.ts 明确未绑定 Tank/Backline 等要求），815.1.b / 815.1.c.2 不可执行。" +
    "依赖：RIFT-91 的卡牌接线、契约 3.8 combatRole 落地、Tank KeywordDef 与 combat 分配批次。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "shield", value: 2 },
    { kind: "keyword", keyword: "tank" }
  ],
  sourceText:
    "[Shield 2] (+2 :rb_might: while I'm a defender.)\n" +
    "[Tank] (I must be assigned combat damage first.)"
} satisfies CardProgram;
