import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Riven, Deserter (rad-114-167) — Unit, 5 Energy + 1 Chaos power, Might 5,
 * tags Riven/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-114-167，逐字）：
 *   "When another friendly unit becomes exhausted, give me +1 :rb_might: this
 *    turn.
 *    Exhaust a friendly unit: Ready a unit. Use this ability only once each turn."
 *
 * 规则依据（CR v1.5）：
 * - 415.1 / 415.1.b：横置把 Board 上的对象标记为 spent；状态变化对应封闭时点
 *   object-exhausted（events/timing-points.ts，ruleRefs 415.1 / 415.1.c）。
 * - "another friendly unit"：本控制者控制、排除来源自身的单位。触发过滤器里用
 *   ObjectFilter.exclude: "source"（契约 3.6 的符号锚点）表达 "another"。
 * - 143.2.a.1 / 475："give me +1 [M] this turn" 是算术图层的临时 Might 修改。
 * - 145.1 / 145.2 / 376 / 381："Exhaust a friendly unit: Ready a unit." 是启动能力，
 *   费用是横置一个友方单位（415.3.a 的横置费用 / 355.5 的费用选择），效果是重置一个
 *   单位（416.1–416.3，已合入 effect.ready）。
 * - 386 / 386.1 / 377.2.b："Use this ability only once each turn." 是启动能力的每回合
 *   使用次数限制，写成 ActivatedAbility.restriction（契约 3.1）。
 *
 * status = judge-required（README 第 2 节）。三处缺口，均不近似实现：
 * 1. "give me +1 [M] this turn" 需要临时 Might 修改（continuous.might + end-of-turn
 *    期限，RIFT-91 layers-continuous 未合入）；effect.buff 明确不含临时 Might 修改
 *    （703 的 Buff 只各自 +1 且是计数器，不是本句的效果）。
 * 2. "Exhaust a friendly unit" 作为费用需要一个可解析到运行时对象的费用选择：
 *    CostSpec 的 choice 是 PickSpec，其 options 只能是静态 Value，费用管线
 *    （cost/plan-values.ts 的 choiceObjects）要求选项是具体 ObjectRef —— 静态 IR 给不出
 *    「当前场上某个友方单位」的引用（同 sfd/assembly-rig 记录的费用选择缺口）。
 * 3. "Use this ability only once each turn"（386/386.1）没有消费方：ActivatedAbility.
 *    restriction 只是数据，chain/cost 不读每回合使用次数；把限制写成触发条件会改变
 *    「限制激活」与「触发条件」的区别（355.17 的强制要求与限制分离）。
 * 另外「another friendly unit becomes exhausted」的 object-exhausted 时点由事件管线
 * 按 exhaust 动作发出（events/action-adapter.ts），但没有已合入订阅方把 CardProgram 的
 * 触发能力注册成 TriggerRegistration。
 * 已按已合入原语写出的部分：object-exhausted 触发 + 目标式的 effect.ready 体
 * （属性选择 "a unit"、转发给已合入的 416.1 语义），golden 测试真实执行 effect.ready。
 * 依赖：RIFT-91（layers-continuous 的临时 Might 与期限）、RIFT-89（费用计划与费用对象
 * 选择）、RIFT-120（chain/events 触发注册与每回合限制消费方）。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "object-exhausted",
      filter: { type: "unit", controller: "controller", exclude: "source" }
    },
    optional: false,
    body: [
      {
        // 143.2.a.1 / 475：本回合 +1 Might 属算术图层；continuous.might 未合入
        // （RIFT-91），此指令只保留印刷语义（见 judgeReason 第 1 点）。
        id: "riven.grant-plus-one",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 1 },
          duration: { kind: "constant", value: "this-turn" },
          target: { kind: "constant", value: "riven.self" }
        },
        targets: [
          {
            id: "riven.self",
            filter: { object: "self", type: "unit" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  },
  {
    kind: "activated",
    cost: {
      // 费用默认落在 energy/power/rune 与 payments 上（契约 3.1 / 3.6 的 CostSpec）。
      payments: [
        {
          // 415.3.a / 415.5：横置一个友方单位作为费用。费用对象必须在 Finalize 前
          // 选定（355.5）；静态 IR 无法给出运行时引用，故 options 是缺口标记
          // （见 judgeReason 第 2 点），不是可执行语义。
          kind: "exhaust",
          choice: {
            id: "riven.exhaust-cost-unit",
            options: ["dynamic:friendly-units-on-board"],
            min: 1,
            max: 1,
            selection: "one",
            zone: "board",
            type: "unit",
            controller: "controller"
          }
        }
      ]
    },
    timing: "action",
    // 386 / 386.1：每回合只能使用一次；限制与要求分离（契约 3.1 的 Restriction）。
    restriction: {
      kind: "usage-limit",
      value: { kind: "constant", value: 1 },
      period: "turn"
    },
    body: [
      {
        // 416.1–416.3："Ready a unit" 选一个单位为目标（355.9，"a unit" 默认指
        // Board 上的单位），转发给已合入的 effect.ready；已就绪的对象不再重置
        // （416.1.b/416.1.c，由原语自身处理）。
        id: "riven.ready-unit",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "target", id: "riven.ready-target" } } },
        targets: [
          {
            id: "riven.ready-target",
            filter: { type: "unit", zone: "board" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-51aab7c27d79de8598bf1c63fd69200050369183a2f0e0d05edba616e72283a2",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) 「give me +1 [M] this turn」需要临时 Might 修改（continuous.might + end-of-turn 期限），" +
    "RIFT-91 layers-continuous 未合入，effect.buff 明确不含临时 Might（703 的 Buff 是计数器）；" +
    "(2) 「Exhaust a friendly unit」作为费用需要能解析到运行时对象的费用选择：CostSpec 的 choice 是 PickSpec，" +
    "options 只能是静态 Value，而费用管线（cost/plan-values.ts choiceObjects）要求选项是具体 ObjectRef，静态 IR 给不出；" +
    "(3) 「Use this ability only once each turn」（386/386.1）没有消费方：ActivatedAbility.restriction 只是数据，" +
    "chain/cost 不读每回合使用次数。另：object-exhausted 时点由事件管线按 exhaust 动作发出，但没有已合入订阅方把 " +
    "CardProgram 的触发能力注册成 TriggerRegistration。已写出的可执行部分：object-exhausted 触发 + 目标式 effect.ready " +
    "（416.1；golden 真实执行）。依赖：RIFT-91（layers-continuous）、RIFT-89（费用计划与费用对象选择）、" +
    "RIFT-120（触发注册与每回合限制消费方）。",
  abilities,
  sourceText:
    "When another friendly unit becomes exhausted, give me +1 :rb_might: this turn.\n" +
    "Exhaust a friendly unit: Ready a unit. Use this ability only once each turn."
} satisfies CardProgram;

