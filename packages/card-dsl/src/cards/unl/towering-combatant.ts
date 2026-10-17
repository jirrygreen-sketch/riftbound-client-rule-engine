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
 * Status: judge-required, matching ogn/sunlit-guardian and ogn/stormclaw-ursine.
 * Both KeywordDefs are now merged (Shield since RIFT-81, Tank since RIFT-264),
 * so both declarations expand — but neither expansion has a runtime consumer:
 * - [Shield 2] (814.1.b / 814.1.b.1 / 814.1.b.2 / 814.1.c / 814.1.d.1) expands
 *   to a static continuous.might ability gated on the Defender designation.
 *   Two pieces are still missing: (a) nothing registers a CardProgram
 *   keyword/static ability into the layers engine (programs/statics.ts ships
 *   only the default noop binder hook); (b) the gate is written as a `compare`
 *   condition on the host's designation, and layers/engine.ts conditionMatches
 *   evaluates no `compare` at all — registering it today would add a
 *   restriction-free +2 Might (the golden pins that over-application).
 * - [Tank] (815.1.b / 815.1.c.1 / 815.1.c.2) expands to a static
 *   continuous.combat damage-assignment requirement, but the merged combat
 *   allocation binds no assignment-priority requirement
 *   (combat/base-combat-allocation.ts: "No Tank/Backline/other
 *   assignment-priority requirement is bound here").
 * Neither keyword is rewritten as static numbers or instructions.
 */
export default {
  canonicalCardId: "card.hash-954548f2a1317ac2bc2954489da0730ecf613acc22887c0dc6c46d250c025391",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两个关键词的 KeywordDef 都已合入（[Shield 2]：effects/keywords/Shield.ts，RIFT-81；[Tank]：effects/keywords/Tank.ts，RIFT-264），" +
    "但展开体都没有运行时消费方：(1) [Shield 2]（814.1.c/814.1.d.1）展开为以 compare(designation eq defender) 为门控的 static " +
    "continuous.might——没有已合入路径把 CardProgram 的 keyword/static 能力注册进 layers（programs/statics.ts 只有默认 noop 的 binder 钩子），" +
    "且 layers/engine.ts 的 conditionMatches 完全不求值 compare，现在注册就等于无条件 +2 Might（golden 固化该过度生效）。" +
    "(2) [Tank]（815.1.b/815.1.c.1/815.1.c.2）展开为 static continuous.combat 的伤害分配优先要求，但 combat/ 的分配不读取它" +
    "（combat/base-combat-allocation.ts 明确注明未绑定 Tank/Backline 等指派优先级），也没有渲染该要求的 continuous.combat 消费方。" +
    "依赖：卡牌关键词/static 能力 → layers 的注册路径与 compare/designation 求值（RIFT-91 后续/RIFT-257）、" +
    "continuous.combat 的战斗伤害分配消费方（RIFT-258 交接/战斗工作流）。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "shield", value: 2 },
    { kind: "keyword", keyword: "tank" }
  ],
  sourceText:
    "[Shield 2] (+2 :rb_might: while I'm a defender.)\n" +
    "[Tank] (I must be assigned combat damage first.)"
} satisfies CardProgram;
