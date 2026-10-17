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
 * Status: judge-required. Re-checked against the merged keyword, program-binding
 * and continuous-effect batches (RIFT-257/258/259/261 follow-ups, 2026-10-16):
 * - Hunt's KeywordDef (RIFT-265) and Level's (RIFT-268) are merged, so the
 *   "no Hunt / no Level entry" gap is obsolete. Hunt's expansion still cannot
 *   subscribe: it authors the event spellings "conquer"/"hold", while the
 *   closed EVENT_PATTERN_TYPES vocabulary is "conquered"/"held"
 *   (events/trigger-spec.ts with the EVENT_NAMES aliases in
 *   events/pipeline-match.ts), so registerProgramTriggers throws
 *   invalid-event-type; and the conquer emission carries no object
 *   (turn/flow.ts Score wave emits { timingPoint, player, details }), so the
 *   source:"self" anchor cannot match the conquering unit (823.1.c.1).
 * - Level's expansion is a `condition.predicate` static effect that no merged
 *   evaluator consumes (layers/engine.ts applyAbility/conditionMatches ignore
 *   that kind and an unknown compare condition evaluates to true), and
 *   PlayerSnapshot.xp is not readable from an Expr, so 824.1.c.1 / 824.1.d
 *   cannot be evaluated.
 * - No merged producer registers a card's static ability as a layer effect
 *   (programs/statics.ts defaults to noopStaticBinder), so the Level-gated
 *   Deflect target tax is never installed; nothing derives a target.tax from a
 *   granted keyword either (the merged target plan bills only a caller-supplied
 *   tax).
 * - The Ganking half needs a movement consumer: continuous.movement registers
 *   (RIFT-258) and the layer engine records the permission, but
 *   zones/movement.ts and effect.move never read it.
 */
export default {
  canonicalCardId: "card.hash-c32a0493f88b4c947cb3f7806d8ba125b166dd6478a848bb39f1da87aed3ae92",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口，均不近似实现（已按 2026-10-16 合入批次复核）：" +
    "(1) [Hunt 2] 的 KeywordDef 已合入（RIFT-265），但它的展开无法订阅：Hunt.ts 写的事件拼写是 \"conquer\"/\"hold\"，" +
    "而封闭 EVENT_PATTERN_TYPES（events/trigger-spec.ts，配 events/pipeline-match.ts 的 EVENT_NAMES 别名）只接受 " +
    "\"conquered\"/\"held\"，registerProgramTriggers 会抛 invalid-event-type；且 conquer 发射不带对象" +
    "（turn/flow.ts 的 Score 波只发 { timingPoint, player, details }），source:\"self\" 锚点匹配不到征服单位（823.1.c.1）；" +
    "(2) [Level 6][>] 的 KeywordDef 已合入（RIFT-268），但展开出的 condition.predicate 静态效果没有任何已合入求值器" +
    "（layers/engine.ts 的 applyAbility/conditionMatches 不识别该 kind，未识别条件按 true），且 PlayerSnapshot.xp " +
    "不是 Expr 可读特征，824.1.c.1 / 824.1.d 的动态失活无法判定；" +
    "(3) [Deflect] 的目标税仍然没有安装方：effects/keywords/Deflect.ts 只声明静态 target.tax 形状，" +
    "没有生产方把 CardProgram 的 static 能力注册成图层效果（programs/statics.ts 缺省 noopStaticBinder），" +
    "也没有任何路径从「已授予的关键词」生成目标税（目标计划只收调用方提供的 tax）；" +
    "(4) [Ganking] 的 continuous.movement 已能注册（RIFT-258）并由图层记录许可，但 zones/movement.ts 与 effect.move " +
    "都不读取该许可（810.1.c/144.4.c）。依赖：conquer/hold 触发拼写与对象载荷（RIFT-120 后续）、" +
    "XP 谓词/图层 compare 求值（RIFT-91 后续）、卡牌 static → layers 注册与目标税消费方（RIFT-257/90）、移动许可消费方。",
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
