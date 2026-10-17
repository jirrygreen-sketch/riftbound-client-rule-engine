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
 *
 * status = judge-required（2026-10-17 复核，逐个缺口写出证据，不近似实现）：
 * 1. 静态绑定入口与 Action 关键词展开都已合入，但本卡的授予句用了 filter 里不存在的
 *    `keyword` 字段：programs/filters.ts 的 translateObjectFilter 直接抛
 *    “Unsupported filter field keyword”，programs/statics.ts 的 staticFilter 同样拒绝
 *    （实测 bindStatic 抛 “Unsupported static filter field keyword”）。
 * 2. 行动许可本身没有消费方：Action 展开出的 continuous.timing 静态能力用的是
 *    `appliesTo: ["card", "activated-ability"]`，而 programs/statics.ts 的 staticTarget 只
 *    接受 `appliesTo: "self"`，实测绑定时抛 “Unsupported static appliesTo”。即使换用 self，
 *    layers/engine.ts 的 applyAbility 会把关键词写进 object.keywords，而唯一读取时机许可的
 *    layers/rules 的 canAct/actionTimings 只读 continuous.timing 的 grants/timings 字段，
 *    不读 keywords——「关键词形式 Action 许可 → 时机许可」仍无接线。
 * 3. “具有 [Deploy]” 的谓词（830.3）不在过滤词汇里：layers/filter.ts 只识别
 *    type/zone/location/controller/owner/states/tags/characteristics，未知 key（如
 *    keyword）被静默忽略（实测 {type:"gear",keyword:"deploy"} 命中全部装备），会
 *    把“带 [Deploy] 的装备”放大成全部装备；触发条件里的 count + keyword 因此也无法诚实求值
 *    （参考内核的 count 查询把 unknown key 交给匹配器，结果不可靠）。Deploy 的 KeywordDef 展开
 *    （effects/keywords/Deploy.ts）自述其 continuous.location 消费方与非单位装备的 cleanup
 *    豁免尚未合入。
 * 已合入并已有执行证据的部分：conquer 触发形状与 effect.channel（exhausted: true）主体——
 * golden 用解释器 + 参考内核真实执行该 channel（431.1/431.2）。
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
    "(1)「Your gear with [Deploy] have [Action]」的静态授予句仍不可绑定：continuous.grant-keyword 原语已合入，" +
    "但 filter 里的 keyword 字段被 programs/filters.ts 的 translateObjectFilter 与 programs/statics.ts 的 staticFilter 拒绝" +
    "（实测分别抛 “Unsupported filter field keyword” 与 “Unsupported static filter field keyword”），无法选出带 [Deploy] 的装备。" +
    "(2) Action 许可没有消费方：Action 展开的 continuous.timing 用 appliesTo: [\"card\",\"activated-ability\"]，而 staticTarget " +
    "只接受 appliesTo: \"self\"（实测抛 “Unsupported static appliesTo”）；即便落地，layers/engine.ts 把关键词写进 object.keywords，" +
    "唯一消费时机许可的 layers/rules 的 canAct/actionTimings 只读 continuous.timing 的 grants/timings，不读 keywords。" +
    "(3)「具有 [Deploy]」的谓词（830.3）不在过滤词汇里：layers/filter.ts 只识别 type/zone/location/controller/owner/states/tags/characteristics，" +
    "未知 key（如 keyword）被静默忽略（实测 {type:\"gear\",keyword:\"deploy\"} 命中全部装备），把「带 [Deploy] 的装备」放大成全部装备；" +
    "触发条件里的 count + keyword 同样无法诚实求值；Deploy 展开（effects/keywords/Deploy.ts）自述其 continuous.location 消费方与" +
    "清理豁免尚未合入。已合入并有执行证据：conquer 触发形状与 effect.channel（exhausted: true）主体，" +
    "golden 用解释器 + 参考内核真实执行该 channel。不近似实现。",
  abilities,
  sourceText:
    "Your gear with [Deploy] have [Action]. (They can be played on your turn or in showdowns.)\n" +
    "When I conquer, if there is a friendly gear with [Deploy] here, channel 1 rune exhausted."
} satisfies CardProgram;

export default program;
