import type { CardProgram } from "../../ir/index.js";

/**
 * Master of Shadows (ven-143-166) — Legend, Fury/Chaos, tag Zed.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-143-166，逐字）：
 *   When you banish a card you own, empower me. (I become Empowered if I'm not already.)
 *   [Action][>] Disempower me, :rb_exhaust:: Discard 1, then draw 1.
 *
 * 规则依据（Core Rules v1.5）：
 * - 383.1 / 383.2.a / 428.1：句首 “When you banish a card you own” 是触发条件；
 *   封闭时点表里 Banish 的观察时点（ruleRefs 428.1、428.2）承载该条件。
 * - 442.1 / 442.2.a：效果 “empower me” 是 Empower 动作，来源自身为对象（827.1.b.1
 *   同样说明 [Empower] 的来源不是目标），已合入的 effect.empower 可真实执行。
 * - 806.1.d / 135.2.e.7.b：[Action][>] 修饰其后启动能力；契约 3.1 用
 *   activated.timing = "action" 记录（与 RIFT-238 的 Heart of the Tempest 同写法）。
 * - 204.1.b / 443.2 / 443.2.a / 415.5：“:” 前的 “Disempower me” 与 :rb_exhaust: 都是
 *   启动费用的组成部分（Disempower 是 Limited Action），必须能完成才能支付（357/358.2）。
 * - 423.1 / 423.4 / 414.1：“Discard 1, then draw 1” 是两条独立指令；“then” 不产生
 *   链接依赖——423.4 明确“无论弃掉几张，随后照常抽牌”，因此抽牌指令不写 linkedTo。
 *
 * status = judge-required（两处当前缺口均不近似实现）：
 * 1. 触发条件写不出来：banish 的观察时点在封闭时点表中是 "card-banished"（events/
 *    timing-points.ts，ruleRefs 428.1/428.2），但 events/trigger-spec.ts 的
 *    EVENT_PATTERN_TYPES 没有该判别值，validateTriggerSpec 会以 invalid-event-type
 *    拒绝注册；且事件载荷没有 “谁放逐 / 谁拥有” 的判别字段，已合入的
 *    translateTriggerFilter 也会以 unsupported filter field 拒绝 player/owner
 *    （契约变更请求）。
 * 2. “Disempower me” 作为启动费用没有付费种类：cost/plan-values.ts 的非标准费用只支持
 *    exhaust/discard/recycle/kill/reveal/spend-buff，没有 disempower（443.2.a）——与
 *    RIFT-238 的 Heart of the Tempest / Matriarch of War 同一缺口（RIFT-261）。
 * 启动能力 → 链的接线本身已合入（describeActivate + translateCost）；当前仍由
 * disempower 费用种类缺失阻止 Finalize 支付，不能把已合入的适配器再次列作缺口。
 * 触发 body 的 “empower me” 与启动 body 的 “Discard 1, then draw 1” 都只用已合入原语，
 * golden 用真实解释器 + 参考内核执行。
 * 依赖：banish 事件的 EventPattern 判别值与载荷（契约变更请求），以及 disempower 费用种类。
 */
const masterOfShadows = {
  canonicalCardId: "card.hash-7e2a7385750d6027b29a1da6a1f5a3301f7cea6ae37c0db13059d67f606b0f5b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口：(1) 触发条件无法注册——封闭时点表的 Banish 观察时点是 card-banished" +
    "（events/timing-points.ts，ruleRefs 428.1/428.2），但 EVENT_PATTERN_TYPES 没有该判别值，" +
    "validateTriggerSpec 会以 invalid-event-type 拒绝；程序按运行时匹配形状（player = 能力控制者、" +
    "owner = 能力控制者）写出 filter，事件载荷也没有这两个判别字段；已合入的 translateTriggerFilter " +
    "会以 unsupported filter field 拒绝），需要事件判别值与载荷扩展（契约变更请求）。 " +
    "(2) “Disempower me” 作为启动费用没有 disempower 付费种类（443.2.a / 443.2）：cost/plan-values.ts 的非标准费用" +
    "只支持 exhaust/discard/recycle/kill/reveal/spend-buff，仍缺 disempower 付费种类，" +
    "程序里以描述性 payment 记录。 " +
    "启动能力 → 链的接线（describeActivate / translateCost）已合入，但缺 disempower 费用种类使该能力" +
    "只能在 Finalize 以 judge-required 失败，没有可执行入口。 " +
    "触发 body 的 “empower me”（442.1）与启动 body 的 “Discard 1, then draw 1”（423.1/423.4/414.1）" +
    "都只用已合入原语，golden 用真实解释器执行。不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-banished",
        filter: {
          event: "card-banished",
          filter: {
            // “you banish”：执行该次放逐的玩家是能力控制者。
            player: "self",
            // “a card you own”：被放逐的牌的拥有者是能力控制者。
            // 说明：card-dsl 校验器把 object 视为对象选择器锚点，不能承载嵌套 ObjectFilter，
            // 因此拥有者约束以扁平键记录（见 judgeReason 第 1 条；生产触发器载荷仍需扩展）。
            owner: "self"
          }
        }
      },
      // 没有 “you may”，是强制触发。
      optional: false,
      body: [
        {
          id: "master-of-shadows.empower-self",
          op: "effect.empower",
          // “empower me”：来源自身（442.1；827.1.b.1 说明来源不是目标）。
          args: {
            objects: { kind: "constant", value: { kind: "source" } }
          }
        }
      ]
    },
    {
      kind: "activated",
      // [Action][>]：能力级许可关键词（806.1.d），按契约 3.1 记在 activated.timing。
      timing: "action",
      cost: {
        kind: "activated",
        payments: [
          // “Disempower me”：443.2 的 Limited Action；作为费用需要 disempower 付费种类
          // （cost/plan-values.ts 暂不支持，见 judgeReason 第 2 条）。
          { kind: "disempower", object: "self" },
          // :rb_exhaust: = Exhaust 此来源（204.1.b、415.5）。
          { kind: "exhaust", object: "self" }
        ]
      },
      body: [
        {
          id: "master-of-shadows.discard-one",
          op: "effect.discard",
          // “Discard 1”：默认弃牌者是能力控制者，选项按 423.1.a 私下选择。
          args: { amount: { kind: "constant", value: 1 } }
        },
        {
          id: "master-of-shadows.draw-one",
          op: "effect.draw",
          // “then” 不产生链接依赖：即使弃牌被否定（423.4 的最后一句），抽牌照常执行。
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText:
    "When you banish a card you own, empower me. (I become Empowered if I'm not already.)\n" +
    "[Action][>] Disempower me, :rb_exhaust:: Discard 1, then draw 1."
} satisfies CardProgram;

export default masterOfShadows;
