import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Miss Fortune, Captain (ogn-162-298) — Unit（能量 5，力量 1，Might 5，Body；
 * Pirate/Miss Fortune/Bilgewater/Champion）。
 *
 * 原文：
 *   [Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to
 *   have me enter ready.)
 *   [Ganking] (I can move from battlefield to battlefield.)
 *   The first time I move each turn, you may ready something else that's exhausted.
 *
 * 规则依据（CR v1.5）：
 * - [Accelerate] 805 / [Ganking] 810：关键词声明（展开分别由已合入的
 *   effects/keywords/Accelerate.ts、Ganking.ts 负责）。
 * - 383.1 / 383.1.b 例："The first time I move each turn…" 是"第 N 次"型触发能力；
 *   "move" 对应 421.1 / 449.1 的 Move，时点 "object-moved"（421.1/449.1/449.2/458）；
 *   "each turn" 用 TriggerSpec.once: "per-turn"（contract 3.1 的 once 生命周期）。
 * - "you may ready something else that's exhausted."：可选（403.1 的 you may）用
 *   choice.optional 包裹（契约 3.9：指令包进 body，不写 choice + linkedTo）；
 *   "something else" 是排除来源自身的选择，用 ObjectFilter.exclude: "source"；
 *   "that's exhausted" 用 states: "exhausted"（trigger-spec.ts 的 ObjectState）。
 *   355.10.d/355.10.d.1："something else that's exhausted" 由特征程序化选定、
 *   任何情况下都不做选择，因此不是目标，用 PickSpec（非目标选择，355.10 + 契约 3.4：
 *   picks 不触发"成为目标"）。

 * status 判定（cards/README.md 第 2 节）：judge-required。RIFT-270 之后复核：
 * - object-moved 时点已由事件管线产生（events/action-adapter.ts 为 "move-location"
 *   动作发出；turn/flow.ts 对 move-location 补发战场进入/离开），per-turn once
 *   频率也已由 pipeline 的 frequencyKey/consume 支持。但仍缺"是本卡在移动"的绑定：
 *   事件物体身份只有运行时 objectId，卡牌程序需要一个 CardProgram →
 *   TriggerRegistration 的适配层（RIFT-257，未合入）把 self 锚点翻译成注册源。
 * - 对局实际的 Standard Move / Ganking 战场间移动（zones/movement）尚未接入唯一
 *   事件管线：duel 侧的 standard move 执行器只把 requiresMoveTriggers 交给外层调用方，
 *   没有已合入模块把它的移动结果提交为 move-location。
 * - "something else that's exhausted" 的 PickSpec 仍无解析入口：chain Finalize 只处理
 *   TargetSpec（target/target-plan.ts 的 finalizePick 没有生产调用方），ctx.picks 仍由
 *   装配层提供；本卡的 filter 还要求"排除来源自身"与 exhausted 状态的组合判定。
 * 依赖：RIFT-257（CardProgram 触发绑定）、Standard Move → 事件管线接线、PickSpec 解析。
 * golden 测试用参考内核真实执行 effect.ready 与 choice.optional 的两条路径（接受/拒绝），
 * 并用结构断言固定 pick 形状。不近似实现（不把"something else"改成来源自身，
 * 也不把非目标选择写成 TargetSpec）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "accelerate" },
  { kind: "keyword", keyword: "ganking" },
  {
    kind: "triggered",
    trigger: {
      at: "object-moved",
      filter: { event: "object-moved", filter: { source: "self" } },
      once: "per-turn"
    },
    optional: true,
    body: [
      {
        id: "miss-fortune.may-ready-other",
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Ready something else that's exhausted?" },
          body: {
            kind: "constant",
            value: [
              {
                id: "miss-fortune.ready-other",
                op: "effect.ready",
                args: { objects: { kind: "constant", value: { kind: "pick", id: "miss-fortune.exhausted-other" } } },
                picks: [
                  {
                    id: "miss-fortune.exhausted-other",
                    options: ["exhausted-object-other-than-source"],
                    filter: { exclude: "source", states: "exhausted" },
                    min: 1,
                    max: 1,
                    selection: "one"
                  }
                ]
              }
            ]
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-541ef049150d65551ee54e4c6763bc4a7009a9e321032a8470f0ec2a2030a8f7",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "移动触发仍不可绑定：（1）object-moved 时点（383.1/383.1.b；421.1/449.1 的 Move）" +
    "已由 RIFT-270 的管线产生（events/action-adapter.ts 为 move-location 动作发出；" +
    "turn/flow.ts 补发战场进入/离开），per-turn once 也已由 pipeline 支持；但卡牌程序" +
    "无法静态表达「是本卡在移动」——事件物体身份只有运行时 objectId，需要一个 " +
    "CardProgram→TriggerRegistration 的绑定层（RIFT-257）把 self 锚点翻译成注册源。" +
    "（2）对局实际的 zones/movement（Standard Move / Ganking 战场间移动）未接入唯一" +
    "事件管线：duel 侧 standard move 执行器只把 requiresMoveTriggers 交给外层调用方。" +
    "（3）“something else that's exhausted” 的非目标选择（355.10.d/355.10.d.1，picks 不" +
    "触发成为目标）没有解析入口：chain Finalize 只处理 TargetSpec（finalizePick 无生产" +
    "调用方），PickSpec 的 filter 解析仍缺。依赖：RIFT-257、Standard Move 接线与 PickSpec 解析。" +
    "Accelerate/Ganking 只按 805/810 声明关键词。golden 测试真实执行 choice.optional 与 " +
    "effect.ready 的接受/拒绝两条路径。不近似实现。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
    "[Ganking] (I can move from battlefield to battlefield.)\n" +
    "The first time I move each turn, you may ready something else that's exhausted."
} satisfies CardProgram;

export default program;
