import type { CardProgram } from "../../ir/index.js";

/**
 * Targonian Visionary (unl-098-219) — Unit, Body, Mount Targon; energy 6, Might 6.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-098-219, verbatim):
 *   [Level 11][>] I have +4 :rb_might:. (While you have 11+ XP, get the effect.)
 *
 * Rules evidence (Core Rules v1.5):
 * - 824.1 / 824.1.a / 824.1.b: [Level N][>] is a Dependent Keyword; from the
 *   keyword to the end of the clause is the Level Ability.
 * - 824.1.b.1 / 824.1.b.2: functionally "While you have [N] or more XP, this
 *   card gains '[Text]'"; here [Text] = "I have +4 :rb_might:".
 * - 824.1.c / 824.1.c.1 / 824.1.d: the Dependent Ability is Active exactly
 *   while the card's controller has N or more XP, and it deactivates again if
 *   that controller's XP drops below N (or the controller changes).
 * - 143.2.a: "+4 :rb_might:" is an arithmetic-layer Might change (the layers
 *   order copy → trait → ability → arithmetic of contract 3.4), not a Buff
 *   counter (702/703 Buffs are objects placed on the unit).
 *
 * Status: judge-required — the [Level 11] KeywordDef itself is merged
 * (effects/keywords/Level.ts, RIFT-268) and expands this card's declaration to a
 * level-active predicate carrying the printed threshold 11, but the two
 * consumers that make the Level Ability execute are still missing:
 * - The predicate has no evaluator: `condition.predicate` / `condition.value`
 *   consumers must read the controlling player's live XP (824.1.c: Active
 *   exactly while the controller has N+ XP; 824.1.c.1 / 824.1.d: it deactivates
 *   again on a drop or a controller change). PlayerSnapshot.xp has no Expr or
 *   predicate path — the frozen Condition algebra (always / never / expression /
 *   compare / all / any / not) cannot read it, and layers/engine.ts
 *   conditionMatches evaluates no `compare` at all, so registering the +4 today
 *   would apply it unconditionally.
 * - No binder attaches the dependent ability text ("I have +4 :rb_might:") to
 *   the predicate, and no merged module registers a CardProgram static ability
 *   into the layers registry (programs/statics.ts ships only the default noop
 *   binder hook).
 *
 * The retained IR keeps the printed amount (4) and the 11-XP gate shape for the
 * follow-up task; the golden test validates the structure, the merged keyword
 * registration, and that the predicate really is not evaluable today.
 */
export default {
  canonicalCardId: "card.hash-7a28733b1d7d68a60f53e6b2afcce546b7e3c138e103f63079734f2d3809e08f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Level 11][>] 的 KeywordDef 已合入（effects/keywords/Level.ts，RIFT-268）：824.1.a–b 的依赖式关键词" +
    "会展开成带阈值 11 的 level-active 谓词（predicate/controller-xp/operator gte），golden 断言该展开形状。" +
    "整卡仍不可执行，两处消费方缺失：(1) 谓词没有求值方——824.1.c/824.1.c.1/824.1.d 要求按控制者实时 XP 判定" +
    "Active 与动态失活，但 PlayerSnapshot.xp 没有 Expr/谓词路径（冻结 Condition 只有 always/never/expression/" +
    "compare/all/any/not），layers/engine.ts 的 conditionMatches 也不求值 compare，因此现在注册 +4 会变成无条件生效。" +
    "(2) 没有 binder 把依赖能力文本「I have +4 :rb_might:」（arithmetic 图层的 continuous.might 修正）挂到该谓词上，" +
    "也没有任何已合入模块把 CardProgram 的 static 能力注册进 layers（programs/statics.ts 只有默认 noop 的 binder 钩子）。依赖：XP 谓词求值（condition.predicate/value 消费方）" +
    "与卡牌 static 能力 → layers 的注册接线（RIFT-91 后续/RIFT-257）。不近似实现。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: 4 },
        filter: { object: "self" }
      },
      // 824.1.b.1：“当你有 11 点或更多 XP 时，本牌获得 ‘I have +4 Might’”。保留形状，见 judgeReason。
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "controller-xp",
          filter: { player: "controller" }
        },
        operator: "gte",
        right: { kind: "constant", value: 11 }
      }
    }
  ],
  sourceText: "[Level 11][>] I have +4 :rb_might:. (While you have 11+ XP, get the effect.)"
} satisfies CardProgram;
