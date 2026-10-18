import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Shard of Undoing (unl-174-219) — Gear, 6 energy, Might null（无印刷 Might）, Order, tags []。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json, unl-174-219）：
 *   "The first time a friendly unit dies during your Beginning Phase each turn, " +
 *   "each opponent must kill one of their units."
 *
 * 规则依据（CR v1.5）：
 * - 383.1："… each turn, …" 起头的句子是触发能力；触发事件是"一个友方单位死亡"。
 *   死亡观察点是封闭时点 object-killed（429.1 / 429.2.a：从 Board 进入 Trash；
 *   808.1.d 记录自身死亡触发在替代处理后、实际换区前收集）。
 * - 429.1.a.1 / 429.6："each opponent must kill one of their units" 是 Kill Instruction
 *   （"Kill [one or more permanents]."）；执行者是各对手自己，用已合入的 effect.kill。
 *   被消灭的单位是各对手按自己意愿选出的（355.10.d 不适用的"必须完成"指示，
 *   355.10.f），因此是 picks（由其它玩家选定的集合，355.10.e），不是目标。
 * - 315.2 / 315.2.a-b："during your Beginning Phase" 把触发窗口限定在本回合的
 *   Beginning 阶段（beginning-start → beginning-end）。
 * - 383.3.e.1 / 383.1 的 "The first time … each turn" 是每回合一次的频度限制。
 *
 * status = judge-required（2026-10-18 复核，缺口不近似实现）：
 * - "during your Beginning Phase" 的阶段窗口没有可执行的触发器过滤：TriggerSpec 的
 *   ObjectFilter / EventPattern 只有对象特征与 fromZone/toZone/amount/details 等键
 *   （events/trigger-spec.ts 的 validateTriggerSpec 还拒绝额外键；programs/filters.ts 的
 *   translateTriggerFilter 也会以 "Unsupported filter field duringPhase" 拒绝，实测），
 *   没有"事件发生在哪个回合/阶段"的谓词；ObjectSnapshot 也不暴露阶段。已合入的 beginning-start 时点
 *   （timing-points.ts）是阶段开始时刻，与"本阶段内任意时刻发生的死亡"不等价——
 *   写成 beginning-start 会漏掉本阶段后续时点造成的死亡，写成无条件 once: "per-turn"
 *   会把其它阶段的死亡也算进来，两者都是错误近似。
 * - "each opponent" 的扇出缺原语：effect.kill 每一条指令只读取一个 picks 集合，没有
 *   按对手逐个绑定"由该对手选择并支付"的循环（与 ogn/kings-edict、rad/suave-negotiator
 *   的 target.player / 多玩家选择缺口同源）。
 * - 通用 CardProgram → TriggerRegistration 接线已合入，且 trigger.once="per-turn" 能通过校验，
 *   但没有消费方认识 duringPhase：扁平写法会被 programs/filters.ts 的 translateTriggerFilter
 *   以 "Unsupported filter field duringPhase" 拒绝（实测），而本卡现在这种带嵌套 object 的写法
 *   会把该字段静默丢弃、产出无阶段限制的 per-turn 触发（实测）；不能把它删掉或误当作无条件触发。
 * - "each opponent" 的扇出缺口还有一个可执行的旁证：picks 的 options 只是记录性占位，
 *   programs 与 chain 都不消费 "runtime:..." 前缀的选项（chain/picks/plan.ts 只接受
 *   zoneSlice/linked 两种显式来源），所以 effect.kill 实际依赖调用方在 Finalize 时提供
 *   已经逐对手选好的 picks 集合。
 * 已合入部分由 golden 真实执行：effect.kill 消费 picks（429.1.a.1 / 429.6），
 * 并在被替代时如实返回 negated/replaced（359.2.c）。
 * 依赖：阶段窗口谓词 / 事件载荷扩展（契约变更请求）、多玩家逐对手选择原语（RIFT-9
 * target.player 家族）；不近似实现。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "object-killed",
      filter: {
        event: "object-killed",
        // "a friendly unit"：死亡者由本能力控制者控制（383.1 的触发条件）。
        object: { type: "unit", controller: "self" },
        // "during your Beginning Phase" 仍等待阶段窗口谓词；每回合一次由 TriggerSpec.once
        // 表达，不能把它错误地折叠为 Beginning Phase 开始时刻。
        duringPhase: "beginning",
      },
      once: "per-turn"
    },
    optional: false,
    body: [
      {
        id: "shard-of-undoing.kill-opponent-units",
        op: "effect.kill",
        args: {
          // 355.10.e / 355.10.f：各对手必须消灭自己单位，由各对手选择；
          // 由其它玩家选定的集合是 picks，不是目标。
          picks: { kind: "constant", value: "shard-of-undoing.opponent-units" }
        },
        picks: [
          {
            id: "shard-of-undoing.opponent-units",
            // 每个对手各选一个自己控制的单位（缺少逐对手扇出，见 judgeReason）。
            options: ["runtime:one-unit-per-opponent"],
            filter: { type: "unit", controller: "opponent" },
            min: 0,
            max: null,
            selection: "any"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-6c9353964d68cf174354c551a4cf9b2c7ca9c3322303954f03d108f7f1bca840",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处缺口（2026-10-18 复核）：(1)「during your Beginning Phase」的阶段窗口没有可执行的触发器过滤：TriggerSpec 的 ObjectFilter / " +
    "EventPattern 只有对象特征与 fromZone/toZone/amount/details 等键（events/trigger-spec.ts 的 " +
    "validateTriggerSpec 还拒绝额外键），没有「事件发生在哪个回合/阶段」的谓词，ObjectSnapshot 也不暴露阶段；" +
    "beginning-start 时点（315.2.a.1）只是阶段开始时刻，与「本阶段内任意时刻的死亡」不等价——写成它会漏掉" +
    "本阶段后续时点造成的死亡，写成无条件 once: \"per-turn\" 又会把其它阶段的死亡算进来，两者都是错误近似。" +
    "(2)「each opponent」缺逐对手扇出：effect.kill 每条指令只读一个 picks 集合，没有按对手逐个绑定" +
    "「由该对手选择并消灭」的循环（与 ogn/kings-edict、rad/suave-negotiator 的玩家选择缺口同源）；" +
    "picks.options 里的 runtime:one-unit-per-opponent 只是记录性占位，chain/picks/plan.ts 只接受 " +
    "zoneSlice/linked 两种显式来源，programs 与 chain 都不消费 runtime: 前缀的选项。" +
    "(3) 通用 CardProgram→TriggerRegistration 接线已合入，trigger.once 可绑定，但没有消费方认识 duringPhase：" +
    "扁平写法会被 programs/filters.ts 的 translateTriggerFilter 以 \"Unsupported filter field duringPhase\" 拒绝（实测），" +
    "而本卡现在这种带嵌套 object 的写法会把该字段静默丢弃、产出无阶段限制的 per-turn 触发（实测）；" +
    "两种结果都不能接受，也不能把它删掉或误当作无条件触发。" +
    "已合入部分由 golden 真实执行：effect.kill 消费 picks（429.1.a.1 / 429.6）。依赖：阶段窗口谓词 / " +
    "事件载荷扩展（契约变更请求）、多玩家逐对手选择（target.player 家族）；不近似实现。",
  abilities,
  sourceText:
    "The first time a friendly unit dies during your Beginning Phase each turn, " +
    "each opponent must kill one of their units."
};

export default program satisfies CardProgram;
