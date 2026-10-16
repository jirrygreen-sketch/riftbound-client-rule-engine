import type { CardProgram } from "../../ir/index.js";

/**
 * Wraith of Echoes (ogn-118-298) — Unit, 6 energy + 1 Mind power, Might 5，
 * 标签 Spirit / Shadow Isles。
 *
 * 原文：The first time a friendly unit dies each turn, draw 1.
 *
 * 规则依据（CR v1.5）：
 * - 383.1：触发能力的关键词包括 “the [Nth] time” 加游戏动作/事件；
 *   383.1.b 同时给出本卡的官方例子与语义：
 *   “The first time another friendly unit dies each turn, draw 1.” —— 触发条件在一次
 *   同时发生的多个死亡里由控制者挑一个作为触发条件，能力只触发一次。
 *   “the first time … each turn” 对应契约的 TriggerSpec.once: "per-turn"
 *   （TRIGGER_ONCE_SCOPES 含 per-turn；events/pipeline.ts 的 frequencyKey 用
 *   [registration id, source ref, scope, clock.turn] 记账，本回合只放行一次）。
 * - “a friendly unit dies”：429.1 的 Kill（永久物从 board 进入 trash）；
 *   封闭时点 object-killed（timing-points.ts，ruleRefs 429.1/429.2/808.1.d）。
 *   事件载荷的 object 是被消灭的单位；“friendly” 指与该能力控制者同一控制者 →
 *   filter.controller: "self"（events/pipeline-match.ts 把 self 解析为“等于触发
 *   控制者”）。
 * - “draw 1”：已有 effect.draw 原语（414.x）。
 *
 * 状态：executable。触发时点、过滤、once-per-turn 与 draw 都在已合入代码路径上，
 * 并已用真实 EventPipeline + ChainEngine 执行验证（见 golden：同一回合第二次友方
 * 单位死亡不再抽牌、敌方单位死亡不触发、跨回合后重新允许触发）。
 *
 * 数据问题（不在本任务范围，未改数据）：本地 deck-catalog 的原文是 "a friendly
 * unit"，而 CR v1.5 条目 383.1.b 的官方例子把同一张牌引作 "The first time
 * **another** friendly unit dies each turn, draw 1."（CR-v1.5.txt:2554）。差别只在
 * 「本卡自身死亡是否触发」这一个情形。本程序按任务指定的 sourceText 逐字实现
 * （filter 不排除 self）；自身死亡那一情形留作 test.todo，等调度者核对该印刷的
 * 权威文本后再定，不擅自按任一读法写成已验证语义。
 */
const wraithOfEchoes = {
  canonicalCardId: "card.hash-4e64e65ef1cdade28cf4d9b17b6ebaef65f79ef63fe60a85357910c6da1deef4",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "object-killed",
        filter: {
          event: "object-killed",
          object: { type: "unit", controller: "self" }
        },
        once: "per-turn"
      },
      optional: false,
      body: [
        {
          id: "wraith.draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText: "The first time a friendly unit dies each turn, draw 1."
} satisfies CardProgram;

export default wraithOfEchoes;
