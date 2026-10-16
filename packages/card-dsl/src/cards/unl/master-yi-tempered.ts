import type { CardProgram } from "../../ir/index.js";

/**
 * Master Yi, Tempered (unl-113-219) — Unit, Body, Master Yi/Ionia/Champion;
 * energy 4, Might 4.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, unl-113-219, verbatim):
 *   [Hunt 2] (When I conquer or hold, gain 2 XP.)
 *   [Level 6][>] I have [Deflect] and [Ganking]. (While you have 6+ XP, opponents
 *   must pay :rb_rune_rainbow: to choose me with a spell or ability and I can
 *   move from battlefield to battlefield.)
 *
 * Rules evidence (Core Rules v1.5):
 * - 823.1 / 823.1.c.1 / 823.1.c.3: Hunt is a Triggered Ability keyword covering
 *   both Conquer and Hold, functionally short for "When I Conquer or Hold, my
 *   controller gains X XP"; X = 2 is this printing's Hunt Value (823.2 sums
 *   multiple sources). The clause is the keyword definition, so only the
 *   keyword is declared (README §5).
 * - 824.1 / 824.1.b.1 / 824.1.b.2 / 824.1.c / 824.1.c.1 / 824.1.d: [Level 6][>]
 *   is a Dependent Keyword; its [Text] ("I have [Deflect] and [Ganking]") is
 *   Active exactly while the card's controller has 6 or more XP, and deactivates
 *   if that controller's XP drops below 6 or the controller changes.
 * - 809.1 / 809.1.c / 809.1.d: [Deflect] from this printing carries no value, so
 *   X is presumed 1 (809.1.b.3) — that is why the declaration omits `value` —
 *   and it imposes the mandatory additional Power cost when an opponent chooses
 *   this unit with a spell or ability.
 * - 810.1 / 810.1.b / 810.1.c.1: [Ganking] adds the Battlefield→Battlefield
 *   Standard Move permission.
 *
 * Status: judge-required. Four merged gaps (none approximated):
 * - No Hunt KeywordDef exists (effects/keywords/ has Accelerate, Action,
 *   Assault, Deathknell, Deflect, Equip, Ganking, Hidden, Legion, Mighty,
 *   Quick-Draw, Reaction, Repeat, Shield, Vision, Weaponmaster), so Hunt 2's
 *   conquer/hold subscription, XP gain and value summing are not implemented.
 * - No kw-level expansion exists and the frozen Condition algebra
 *   (always / never / expression / compare / all / any / not) has no path to
 *   PlayerSnapshot.xp, so 824.1.c.1 / 824.1.d cannot be evaluated.
 * - The Deflect half needs the ":rb_rune_rainbow:" any-domain Power tax to be
 *   billed for a granted keyword: effects/keywords/Deflect.ts expands into the
 *   static target.tax shape and the merged target plan charges it, but no merged
 *   producer turns a CardProgram static ability into the registered effect, and
 *   the Level gate cannot be attached.
 * - The Ganking half needs a continuous.grant-keyword registration and a
 *   movement consumer; zones/movement.ts and effect.move do not read that
 *   permission.
 */
export default {
  canonicalCardId: "card.hash-c32a0493f88b4c947cb3f7806d8ba125b166dd6478a848bb39f1da87aed3ae92",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口，均不近似实现：(1) [Hunt 2] 只是关键词声明——effects/keywords/ 没有 Hunt.ts，" +
    "823.1.c.1 的 conquer/hold 订阅与获得 2 XP、823.2 的多来源相加未实现；" +
    "(2) [Level 6][>] 依赖式关键词（824.1.b.1）没有 kw-level 展开：824.1.c / 824.1.d 需要可求值的" +
    "「控制者 XP ≥ 6」谓词与动态失活，而 Condition 只有 always/never/expression/compare/all/any/not，" +
    "读取 PlayerSnapshot.xp 没有进入 Expr/谓词的路径；" +
    "(3) [Deflect] 一半需要把授予的目标税真正计费：effects/keywords/Deflect.ts 只声明静态 target.tax 形状，" +
    "没有任何已合入生产方把 CardProgram 的 static 能力注册成持续效果，且该效果还必须被上面的 XP 门槛守住；" +
    "(4) [Ganking] 一半需要 continuous.grant-keyword 注册路径与移动许可消费方（810.1.c/144.4.c）：" +
    "zones/movement.ts 与 effect.move 都不读取该许可。依赖：Hunt / Level 关键词展开、XP 谓词路径、RIFT-91 卡牌接线与 combat/movement 消费方。",
  abilities: [
    // 823.1.c.3：X 是本印刷的 Hunt Value 2。
    { kind: "keyword", keyword: "hunt", value: 2 },
    {
      kind: "static",
      // 824.1.b.1 的依赖能力之一：获得 [Deflect]（809.1.b.3：印刷省略数值即 X=1），
      // 由卡牌声明在 6+ XP 门槛下；展开由 Deflect KeywordDef 负责。
      effect: {
        kind: "continuous.grant-keyword",
        keyword: "Deflect",
        value: { kind: "constant", value: 1 },
        filter: { object: "self" }
      },
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "controller-xp",
          filter: { player: "controller" }
        },
        operator: "gte",
        right: { kind: "constant", value: 6 }
      }
    },
    {
      kind: "static",
      effect: {
        kind: "continuous.grant-keyword",
        keyword: "Ganking",
        filter: { object: "self" }
      },
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "controller-xp",
          filter: { player: "controller" }
        },
        operator: "gte",
        right: { kind: "constant", value: 6 }
      }
    }
  ],
  sourceText:
    "[Hunt 2] (When I conquer or hold, gain 2 XP.)\n" +
    "[Level 6][>] I have [Deflect] and [Ganking]. (While you have 6+ XP, opponents must pay :rb_rune_rainbow: to choose me with a spell or ability and I can move from battlefield to battlefield.)"
} satisfies CardProgram;
