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
 * Status: judge-required, two merged gaps (not approximated):
 * - No kw-level expansion exists. The merged keyword set (effects/keywords/
 *   files delivered by RIFT-81~88: Accelerate, Action, Assault, Deathknell,
 *   Deflect, Equip, Ganking, Hidden, Legion, Mighty, Quick-Draw, Reaction,
 *   Repeat, Shield, Vision, Weaponmaster) has no Level entry, and the frozen
 *   Condition algebra (always / never / expression / compare / all / any / not)
 *   has no path to PlayerSnapshot.xp, so 824.1.c.1/.d cannot be evaluated.
 * - The +4 Might is a continuous.might arithmetic-layer effect; no merged
 *   consumer turns a CardProgram static ability into a ContinuousEffectSpec
 *   (RIFT-91 delivered the layer engine, not the card wiring), and the layer
 *   engine's conditionMatches does not evaluate `compare` — writing the gate as
 *   `always` would apply +4 unconditionally, which is why it is not done.
 *
 * The retained IR keeps the printed amount (4) and the 11-XP gate shape for the
 * follow-up task; the golden test only validates structure and the missing
 * keyword registration.
 */
export default {
  canonicalCardId: "card.hash-7a28733b1d7d68a60f53e6b2afcce546b7e3c138e103f63079734f2d3809e08f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1) [Level 11][>] 是依赖式关键词（824.1 / 824.1.a–d）：需要 kw-level 展开把" +
    "「控制者有 11 点或更多 XP 时该依赖能力 Active」做成可求值谓词，并支持 824.1.c.1 / 824.1.d 的" +
    "动态失活；合并的关键词集合（RIFT-81~88 交付的 16 个 KeywordDef）里没有 Level，Condition 只有" +
    "always/never/expression/compare/all/any/not，读取 PlayerSnapshot.xp 没有进入 Expr/谓词的路径。" +
    "(2)「I have +4 :rb_might:」是 arithmetic 图层的 continuous.might 修正，没有已合入路径把 CardProgram 的" +
    "static 能力注册成 ContinuousEffectSpec（RIFT-91 只合入图层引擎，未接卡牌侧），且层引擎的 conditionMatches 不求值" +
    "compare/XP 条件，改成 always 就等于无条件 +4，属近似实现。依赖 kw-level 展开、XP 谓词路径与 RIFT-91 的卡牌接线。",
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
