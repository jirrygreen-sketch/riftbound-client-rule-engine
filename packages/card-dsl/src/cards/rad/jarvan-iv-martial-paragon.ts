import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Jarvan IV, Martial Paragon (rad-091-167) — Unit, 4 energy + 1 Body power,
 * Might 4, 标签 Demacia/Jarvan IV/Champion。
 *
 * 原文（packages/card-data/data/deck-catalog.json，sourceText 逐字）：
 *   Your gear with [Deploy] have [Action]. (They can be played on your turn or
 *   in showdowns.)
 *   When I conquer, if there is a friendly gear with [Deploy] here, channel 1
 *   rune exhausted.
 *
 * 规则依据（CR v1.5）：
 * - "Your gear with [Deploy] have [Action]"：806 的许可类关键词授予（静态持续效果，
 *   把 Action 时机许可加给符合条件的 gear）。"是否有 [Deploy]" 是 830.3 的可引用特征；
 *   filter 用 tag/keyword 描述条件（由 layers/predicate 消费）。
 * - "When I conquer"：383.4.c/.c.1 的 Conquer Effect，时点 conquer（468.5.d、471.1、
 *   473.2.a）；filter 指向自身。
 * - "if there is a friendly gear with [Deploy] here"：触发条件（383.2 的 Condition），
 *   条件范围是整条触发能力，"here" = 来源所在位置（sameLocationAs: self）。
 * - "channel 1 rune exhausted"：431.1/431.2 的 channel 动作并注明就绪状态，已合入
 *   effect.channel 原语（exhausted: true，431.2.a 的 "channel 1 rune exhausted" 形式）。
 */
const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      kind: "continuous.grant-keyword",
      keyword: "Action",
      filter: {
        type: "gear",
        controller: "controller",
        zone: "board",
        keyword: "Deploy"
      }
    }
  },
  {
    kind: "triggered",
    trigger: {
      at: "conquer",
      filter: { event: "conquer", filter: { source: "self" } },
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "gear",
          filter: {
            type: "gear",
            controller: "controller",
            zone: "board",
            keyword: "Deploy",
            sameLocationAs: "self"
          }
        },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
    },
    optional: false,
    body: [
      {
        id: "jarvan-iv-martial-paragon.channel",
        op: "effect.channel",
        args: {
          amount: { kind: "constant", value: 1 },
          exhausted: { kind: "constant", value: true }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-24736fa17d67e359a6f4e4ecf2a322db223ee66f6f8e1041e5e227e305a50dee",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处依赖未合入：(1) 「Your gear with [Deploy] have [Action]」需要把关键词授予落实为时机许可的" +
    "静态持续效果（continuous.grant-keyword 由 layers（RIFT-91）消费，Action 的展开见 effects/keywords/Action.ts），" +
    "且「具有 [Deploy]」的谓词（CR 830.3）没有已合入的 filter 求值路径；" +
    "(2) 触发条件「if there is a friendly gear with [Deploy] here」依赖 count/filter 中 keyword 与" +
    "sameLocationAs 的求值，当前上下文只把普通字段交给底层 query（RIFT-90 目标/谓词落地前不能诚实求值），" +
    "并且 [Deploy] 关键词本身尚无已合入 KeywordDef。已合入的部分：conquer 触发形状与 effect.channel" +
    "（exhausted: true）主体，golden 测试用解释器 + 参考内核真实执行该 channel。",
  abilities,
  sourceText:
    "Your gear with [Deploy] have [Action]. (They can be played on your turn or in showdowns.)\n" +
    "When I conquer, if there is a friendly gear with [Deploy] here, channel 1 rune exhausted."
} satisfies CardProgram;

export default program;
