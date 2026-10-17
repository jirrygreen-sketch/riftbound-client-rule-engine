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
 * 2026-10-17 再复核：整卡仍为 judge-required；当前缺口见 judgeReason。
 * 已合入原语与关键词声明不等于生产链路可执行；局部执行证据见同名单卡测试。
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
    "continuous.might 的 +1 Might 与本回合到期已可执行。剩余：(1) Exhaust a friendly unit 的费用选择仍停在动态字符串占位；cost/plan-values.ts 的 choiceObjects 要求 exact object reference，没有从合法友方单位过滤到费用选项的绑定（CR 355.5、415.5）。" +
    "(2) 每回合一次（386/386.1）的 usage-limit 仍被 translateRestriction 以 needs a rules adapter 拒绝，未与启动成功记录及回合重置接线。" +
    "(3) object-exhausted 有真实生产者，解释器也已支持符号对象锚点，但生产 programs/filters.ts 仍报 Unsupported filter field exclude / Unsupported filter field object，无法绑定「another friendly unit」与自身目标。缺口位于生产过滤翻译，不是通用 ObjectSelector 不存在。",
  abilities,
  sourceText:
    "When another friendly unit becomes exhausted, give me +1 :rb_might: this turn.\n" +
    "Exhaust a friendly unit: Ready a unit. Use this ability only once each turn."
} satisfies CardProgram;

