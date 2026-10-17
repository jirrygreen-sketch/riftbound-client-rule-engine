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
 * Status: judge-required. Execution evidence: templates/keyword-static-static-673.test.mjs.
 * Re-checked against the merged keyword, program-binding
 * and continuous-effect implementations (2026-10-17; every claim is measured):
 * 1. Hunt's KeywordDef and Level's expansion are merged, but Hunt's expansion
 *    still cannot subscribe: it authors the event spellings "conquer"/"hold",
 *    while the closed EVENT_PATTERN_TYPES vocabulary is "conquered"/"held"
 *    (events/trigger-spec.ts), so registerProgramTriggers throws a
 *    TriggerSpecValidationError (invalid-event-type) - verified directly. The
 *    conquer emission also carries no object (turn/flow.ts Score wave emits
 *    { timingPoint, player, details }), so the source:"self" anchor could not
 *    match the conquering unit (823.1.c.1).
 * 2. The card's own Deflect/Ganking grants DO register and apply, but their
 *    [Level 6][>] gate is not evaluated at all: the condition is the authored
 *    count(subject: "controller-xp", filter: { player: "controller" }), whose
 *    subject is not a query the context understands. Measured: the layers grant
 *    both keywords at 0, 5, 6 and 10 XP alike, so 824.1.c.1 / 824.1.d is not
 *    implemented. This is NOT a fail-closed unknown compare: the count falls
 *    back to a plain object count and the threshold passes.
 * 3. Level's own expansion is a `condition.predicate` static effect, and the
 *    production static binder rejects that kind outright ("Static ability kind
 *    condition.predicate has no layer mapping") - verified.
 * 4. No path derives a Deflect target.tax from a granted keyword: target.tax has
 *    no layer mapping in the static binder, and the target plan still bills only
 *    a caller-supplied tax.
 * 5. The Ganking half needs a movement consumer: the keyword expansion registers
 *    continuous.movement with permission "battlefield-to-battlefield", but the
 *    movement query reads permission.routes, so movement(...) reports
 *    canGank: false even while the registration is present - verified.
 */
export default {
  canonicalCardId: "card.hash-c32a0493f88b4c947cb3f7806d8ba125b166dd6478a848bb39f1da87aed3ae92",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "五处当前缺口，均不近似实现（2026-10-17 实测）：" +
    "(1) [Hunt 2] 的 KeywordDef 已合入，但它的展开无法订阅：Hunt.ts 写的事件拼写是 \"conquer\"/\"hold\"，" +
    "而封闭 EVENT_PATTERN_TYPES（events/trigger-spec.ts）只接受 \"conquered\"/\"held\"，registerProgramTriggers " +
    "实测抛 TriggerSpecValidationError（invalid-event-type）；且 conquer 发射不带对象" +
    "（turn/flow.ts 的 Score 波只发 { timingPoint, player, details }），source:\"self\" 锚点匹配不到征服单位（823.1.c.1）；" +
    "(2) 本卡的 [Level 6][>] 门槛仍无玩家 XP 求值接口：条件写作 count(subject: \"controller-xp\", filter: { player: \"controller\" })，" +
    "该 subject 不是上下文认识的查询，未保护时 count 退化成对象计数；现以 never 显式阻断待接线分支，防止错误授予 " +
    "[Deflect] 与 [Ganking]，824.1.c.1 / 824.1.d 的 6+ XP 门控与失活都没有实现（never 只表示 blocked，不证明 Level 已实现）；" +
    "(3) [Level] 自身的展开是 condition.predicate 静态效果，programs/statics.ts 实测以 " +
    "\"Static ability kind condition.predicate has no layer mapping\" 拒绝绑定；" +
    "(4) [Deflect] 的目标税仍未接通：target.tax 在静态绑定里没有图层映射，目标计划也只收调用方提供的 tax；" +
    "(5) [Ganking] 的 continuous.movement 已能注册，但展开形状是 permission: \"battlefield-to-battlefield\"，" +
    "而移动查询读 permission.routes，实测 movement(...) 在注册存在时仍报 canGank: false；" +
    "zones/movement.ts 与 effect.move 也不消费该许可（810.1.c/144.4.c）。" +
    "依赖：conquer/hold 触发拼写与对象载荷、可读的 XP 谓词/图层求值、目标税消费方与移动许可消费方。",
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
        // CR 824.1.c/d: pending player XP query; never substitute object count.
        kind: "all",
        conditions: [
          { kind: "never" },
          {
            kind: "compare",
            left: {
              kind: "count",
              subject: "controller-xp",
              filter: { player: "controller" }
            },
            operator: "gte",
            right: { kind: "constant", value: 6 }
          }
        ]
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
        // CR 824.1.c/d: pending player XP query; never substitute object count.
        kind: "all",
        conditions: [
          { kind: "never" },
          {
            kind: "compare",
            left: {
              kind: "count",
              subject: "controller-xp",
              filter: { player: "controller" }
            },
            operator: "gte",
            right: { kind: "constant", value: 6 }
          }
        ]
      }
    }
  ],
  sourceText:
    "[Hunt 2] (When I conquer or hold, gain 2 XP.)\n" +
    "[Level 6][>] I have [Deflect] and [Ganking]. (While you have 6+ XP, opponents must pay :rb_rune_rainbow: to choose me with a spell or ability and I can move from battlefield to battlefield.)"
} satisfies CardProgram;
