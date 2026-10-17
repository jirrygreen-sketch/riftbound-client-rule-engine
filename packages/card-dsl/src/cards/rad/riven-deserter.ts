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
 * status = judge-required（README 第 2 节）。RIFT-258 合入后逐条复核：
 * 1. "give me +1 [M] this turn" **已可执行**——continuous.might 已注册
 *    （effects/instructions/continuous.might.ts），layers/ops/index.ts 的
 *    resolveContinuousDuration 把 "this-turn" 映射为 end-of-turn 到期，
 *    buildMightSpec 为每个解析对象注册 arithmetic 图层 spec；golden 通过真实
 *    解释器 + 测试内核执行整条触发体并检查注册结果与到期时点。
 * 2. "Exhaust a friendly unit" 作为费用仍缺可解析到运行时对象的费用选择：
 *    cost/plan-values.ts 的 choiceObjects/paymentObjects 只接受 PickSpec.options 中的
 *    具体 { id, zoneEntryId }（或 Expr 求值出的具体引用），filter/zone/type/controller
 *    只是数据、planner 不据此查询，静态 IR 给不出「当前场上某个友方单位」的引用。
 *    费用种类与 cost.pay/cost.modify（RIFT-261）在本 HEAD 尚未合入。
 * 3. "Use this ability only once each turn"（386/386.1）仍没有消费方：
 *    ActivatedAbility.restriction 只是数据，chain/ 与 cost/ 不读每回合使用次数
 *    （chain/engine.ts 只校验 ChainItem.requirements/restrictions 上的 Condition，
 *    没有任何已合入代码把卡牌的 usage-limit 转成该 Condition）；
 *    把带 restriction 的启动能力接进来属正在进行的 RIFT-257。
 * 触发侧同样依赖 RIFT-257：object-exhausted 时点已由事件管线按 exhaust 动作发出
 * （events/action-adapter.ts 的 ACTION_TIMINGS），但没有已合入订阅方把 CardProgram 的
 * triggered ability 转成 TriggerRegistration；本卡过滤器用的 exclude 锚点与
 * controller: "controller" 选择器也不在引擎 trigger-spec 词表内（无 exclude 锚点、
 * PlayerSelector 无 "controller"），注册 fail-closed 而不是静默过度触发。
 * 已按已合入原语写出的部分：object-exhausted 触发 + 目标式的 continuous.might 效果 +
 * 目标式的 effect.ready 体（属性选择 "a unit"、转发给已合入的 416.1 语义），
 * golden 测试真实执行这两段。
 * 依赖：RIFT-261（费用对象选择）、RIFT-257（触发注册与每回合使用次数消费方）。
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
        // 143.2.a.1 / 475：本回合 +1 Might 属算术图层，由 continuous.might 注册
        // （RIFT-258；layers/ops/index.ts 的 buildMightSpec + resolveContinuousDuration）。
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
          // 选定（355.5）；本 HEAD 的费用管线只接受具体引用，故 options 是缺口标记
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
    "两处缺口，均不近似实现：(1) 「Exhaust a friendly unit」作为费用需要能解析到运行时对象的费用选择：" +
    "cost/plan-values.ts 的 choiceObjects/paymentObjects 只接受 PickSpec.options 中的具体 { id, zoneEntryId }，" +
    "filter/zone/type/controller 只是数据、planner 不据此查询，静态 IR 给不出「当前场上某个友方单位」的引用；" +
    "费用种类与 cost.pay/cost.modify（RIFT-261）在本 HEAD 尚未合入。(2) 「Use this ability only once each turn」" +
    "（386/386.1）没有消费方：ActivatedAbility.restriction 只是数据，chain/ 与 cost/ 不读每回合使用次数，" +
    "也没有已合入代码把它转成 chain/engine.ts 校验的 Requirement/Restriction Condition（RIFT-257）。" +
    "触发侧同样依赖 RIFT-257：object-exhausted 时点已有生产者（events/action-adapter.ts），但没有已合入订阅方把 " +
    "CardProgram 的 triggered ability 转成 TriggerRegistration；本卡过滤器用的 exclude 锚点与 controller: \"controller\" " +
    "选择器也不在引擎 trigger-spec 的 ObjectFilter 词表内，注册会 fail-closed，不会静默过度触发。" +
    "已可执行部分：「give me +1 [M] this turn」经 continuous.might（RIFT-258）注册 arithmetic 图层效果并在回合结束到期，" +
    "golden 用真实解释器 + 测试内核执行整条触发体。依赖：RIFT-261、RIFT-257。",
  abilities,
  sourceText:
    "When another friendly unit becomes exhausted, give me +1 :rb_might: this turn.\n" +
    "Exhaust a friendly unit: Ready a unit. Use this ability only once each turn."
} satisfies CardProgram;

