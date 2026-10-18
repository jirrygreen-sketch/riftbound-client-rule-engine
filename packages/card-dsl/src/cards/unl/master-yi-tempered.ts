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
 * 2026-10-18 复核：整卡仍为 judge-required；当前生产缺口见 judgeReason。
 * 已支持子效果的执行证据保留在对应 golden；不以原语存在替代整卡可执行性。
 */
export default {
  canonicalCardId: "card.hash-c32a0493f88b4c947cb3f7806d8ba125b166dd6478a848bb39f1da87aed3ae92",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口：(1) Hunt.ts 的 conquer/hold 过滤事件名不在 EVENT_PATTERN_TYPES 的 conquered/held 词表中，registerProgramTriggers 报 TriggerSpecValidationError；计分事件也无单位 object 供 When I 匹配（823.1.c.1）。" +
    "(2) [Level 6] 缺控制者实时 XP 求值与控制权/XP 变化时的失活（824.1.c.1/824.1.d）：controller-xp 的 count 仍只数对象，condition.predicate 无默认静态映射；现有 never 保持阻断。" +
    "(3) Deflect 的 target.tax 无默认 static binder 映射，chain/engine.ts 也未接 target/tax 的任意域 Power 适配器，仍将显式税额记作 Energy（809.1.c.1）。" +
    "(4) KeywordGrantLayerEngine 已支持静态关键词重展开，并将 Ganking 的 permission 转为 permission.routes；默认 programs/lifecycle.ts 尚未接入，标准移动已有 registry 规则查询接口，但缺默认生命周期将该适配器结果接入移动路径（810.1.c）。",
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
