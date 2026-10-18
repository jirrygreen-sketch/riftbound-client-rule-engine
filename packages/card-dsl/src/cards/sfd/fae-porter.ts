import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Fae Porter (sfd-125-221) — Unit, Chaos, tags Fae/Ionia.
 * energy 4, power: none printed, Might 4.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-125-221，逐字）:
 *   "When I move to a battlefield, you may pay :rb_rune_chaos: to move a unit you control to the same battlefield."
 *
 * 规则依据（CR v1.5）：
 * - "When I move to a battlefield"（421.1、449.1/449.2）：封闭时点 object-moved 表示一次成功的
 *   Move；458/458.1 的 Recall 不是 Move。filter 用 EventPattern 的 toZone: "battlefield" 表达
 *   「移动到战场」，内层锚点 source: "self" 指称本卡（已合入 sfd/corinna-veraza、
 *   ogn/noxian-drummer 采用同一写法）。
 * - "you may pay :rb_rune_chaos:"：403.1 的 "you may" 是可选效果，契约 3.9 要求把被选指令
 *   包进 choice.optional 的 body；费用是 1 点 Chaos 力量（163.1/163.2 的 Power，域匹配由
 *   费用计划在 Finalize 检查），用 cost.pay 的 payments record 声明。
 * - "move a unit you control to the same battlefield"：451 的效果移动（不是标准移动，不加
 *   144.2 的横置费用/主阶段门槛）；"a unit you control" 是选择的具体对象，属目标
 *   （355.10 / 355.9.a.1）；"the same battlefield" 是运行期 Location——能力来源当前所在的战场
 *   （"here" 的 referent，359.3.f.1：从来源读取、指令执行时检查、359.3.f.2）。
 *   已合入的 sfd/azir-sovereign（"to this battlefield"）用 condition.value 在结算时读出来源
 *   位置，再由 effect.move 的 to 经 linked-value 读取，该形状被原语接受。
 *
 * Status: judge-required (re-probed 2026-10-18). object-moved has a timing
 * point/producer but is not accepted by EVENT_PATTERN_TYPES, so the trigger
 * cannot be registered at all. programs/triggers.ts also does not lift this
 * leading choice/payment into TriggerRegistration.cost/mayAtFinalize
 * (383.3.a/b), although Finalize can already consume those fields. cost.pay,
 * target-controller normalization and effect.move are merged. Tests execute
 * the authored body, asserting the allocator's exact Power payment; the
 * reference kernel does not deduct Power from its pool.
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "object-moved",
      filter: {
        event: "object-moved",
        toZone: "battlefield",
        filter: { source: "self" }
      }
    },
    optional: false,
    body: [
      {
        id: "fae-porter.may-pay",
        op: "choice.optional",
        args: {
          prompt: {
            kind: "constant",
            value: "Pay :rb_rune_chaos: to move a unit you control to this battlefield?"
          },
          body: {
            kind: "constant",
            value: [
              {
                id: "fae-porter.pay-chaos",
                op: "cost.pay",
                args: {
                  // 1 点 Chaos 力量（163.1/163.2）；域匹配与可支付性由费用计划在 Finalize 检查。
                  payments: { kind: "constant", value: { power: ["Chaos"] } }
                }
              },
              {
                // "to the same battlefield"：静态 IR 不能写运行时 LocationRef，先用
                // condition.value 在结算时读出来源当前位置（359.3.f.1 的 referent）。
                id: "fae-porter.read-battlefield",
                op: "condition.value",
                args: {
                  value: {
                    kind: "object-property",
                    object: "source",
                    property: "location"
                  },
                  key: { kind: "constant", value: "here" }
                }
              },
              {
                id: "fae-porter.move-unit",
                op: "effect.move",
                linkedTo: "fae-porter.read-battlefield",
                args: {
                  objects: {
                    kind: "constant",
                    value: { target: "fae-porter.friendly-unit" }
                  },
                  to: {
                    kind: "linked-value",
                    instructionId: "fae-porter.read-battlefield",
                    key: "here"
                  },
                  amount: { kind: "constant", value: 1 },
                  linkKey: { kind: "constant", value: "moved" }
                },
                targets: [
                  {
                    id: "fae-porter.friendly-unit",
                    filter: { type: "unit", controller: "controller", zone: "board" },
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
  canonicalCardId: "card.hash-a08970a66c071f3fd82fd5a9ca7f63e01c9674666037e987829b498e9b9b58db",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处缺口（2026-10-18 实测）：" +
    "（1）object-moved 在 timing-points.ts/action-adapter.ts 中已有时点与移动事件，但不在 EVENT_PATTERN_TYPES，" +
    "registerTrigger 以 invalid-event-type@trigger.filter.event 拒绝该订阅（实测），事件管线因此无法扫描到本卡的触发；" +
    "该映射同样不填 toZone/toKind，449.1/449.2 的战场终点与 458 的 Recall 排除都无从判定。" +
    "（2）383.3.a/383.3.b/383.3.b.1 要求开头的可选支付在 Finalize 处理，" +
    "但 programs/triggers.ts 未把 choice.optional/cost.pay 提取到已有的 TriggerRegistration.cost/mayAtFinalize——" +
    "1 Chaos Power 的 cost.pay 本身已可计划并发出准确的 pay 回执（163.1/163.2，golden 真实执行）。" +
    "另：可选 body 内的 effect.move TargetSpec 会被 chain/engine.ts 的 assertFinalizationSurface 以 " +
    "\"Nested/repeated targets require an interpreter target-selection lifecycle adapter\" 阻断。" +
    "目标 controller 锚点可由 programs/filters.ts 归一化为 self，不再视为缺口；" +
    "effect.move 与结算期来源位置读取（359.3.f.1）已有执行测试。" +
    "测试内核 pay 不扣 Power，只能验证真实支付动作与分配回执，不能宣称 Power 池扣减已验证。",
  abilities,
  sourceText:
    "When I move to a battlefield, you may pay :rb_rune_chaos: to move a unit you control to the same battlefield."
} satisfies CardProgram;

export default program;
