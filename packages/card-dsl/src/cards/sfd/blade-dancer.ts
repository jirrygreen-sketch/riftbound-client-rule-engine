import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Blade Dancer (sfd-195-221) — Legend, Calm/Chaos, tag Irelia.
 * energy: null / power: null / might: null（传奇没有印刷费用与 Might；null 不是 0）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-195-221，逐字）:
 *   "When you choose a friendly unit, you may exhaust me and pay :rb_rune_rainbow: to ready it.\n"
 *   "When you conquer, you may pay :rb_energy_1: to ready me."
 *
 * 规则依据（CR v1.5）：
 * - "When you choose a friendly unit" 是 Targeting Effect（383.4.b/383.4.b.1/383.4.b.3）：
 *   条件是某个 Game Object 成为 Target；355.6/355.7 决定什么算 Targeting。封闭时点里只有
 *   became-target（events/timing-points.ts，refs 355.7/383.4.b）对应它；"choose" 是选目标，
 *   不是非目标 pick（契约 3.4/3.9）。
 * - "you" = 能力控制者（190.6.d 的隐含控制者；383.4.b.2 在该 GameObject 被 Target 后把该能力
 *   作为 Pending Item 入链），因此 filter.player 用 "self"（events/trigger-spec.ts 的
 *   PlayerSelector：self/opponent/any/{playerId}）。
 * - "friendly"（740.1.a：共享控制者）用 ObjectFilter 的 controller: "self" 表达，相对于能力
 *   控制者解释（events/pipeline-match.ts 的 playerMatches 只归一化 self/opponent）。
 * - "When you conquer" 是 Conquer Effect（383.4.c/383.4.c.2.b：引用做出 Conquer 的玩家的能力）；
 *   封闭时点 conquer（refs 468.5.d/471.1/473.2.a）由 turn/flow.ts 的计分 wave 发出。
 * - 两处 "you may" 都是效果首段的可选项（403.1/383.3.a：控制者在 Finalization 决定是否执行该
 *   触发式能力），因此 TriggeredAbility.optional = true；同时按契约 3.9 把被选指令包进
 *   choice.optional 的 body（不写 choice + linkedTo），与 azir-sovereign/veiled-temple 同型。
 * - "exhaust me and pay :rb_rune_rainbow:" 是 740.4.a 的 "[do X] to [do Y]" 代价式结构；
 *   740.4.a.2 规定触发能力效果首段的代价在 Finalization 支付。415.5 说明能力里的 :rb_exhaust:
 *   是费用 "Exhaust this/me"，415.4 要求该动作必须能完成才算支付。费用用 cost.pay 的 payments
 *   形状声明（cost/plan-values.ts 已支持 { kind: "exhaust", object: "self" }），不用
 *   effect.exhaust 的结算时状态改变冒充费用。
 * - ":rb_rune_rainbow:" 是任意域（Universal）Power（135.2.e.5.b、163.2.b）。
 * - "ready it"：it 是触发事件里被选中的那个友方单位（本次 choose 的对象）。静态 IR 不能写运行时
 *   ObjectRef（契约 3.6），这里用 TargetSpec 作占位选择符，与 mistfall/pirates-haven 同型。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * 依赖与缺口见 judgeReason；golden 测试用解释器 + 参考内核真实执行已合入的 effect.ready 与
 * 费用计划的 exhaust 支付（不是整卡执行证据）。
 * 不近似实现：不用 effect.exhaust 冒充费用式横置，不把 choose 写成 pick，不选一个域冒充 [A]。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "became-target",
      filter: {
        event: "became-target",
        // "you choose a friendly unit"：选择者是能力控制者，被选对象是受该玩家控制的单位。
        player: "self",
        target: { type: "unit", controller: "self" }
      }
    },
    optional: true,
    body: [
      {
        id: "blade-dancer.may-ready-chosen",
        op: "choice.optional",
        args: {
          prompt: {
            kind: "constant",
            value: "Exhaust Blade Dancer and pay :rb_rune_rainbow: to ready that unit?"
          },
          body: {
            kind: "constant",
            value: [
              {
                // "exhaust me and pay :rb_rune_rainbow:"：740.4.a.2 的代价在 Finalization
                // 支付，形状是费用计划（415.4/415.5），不是结算时的状态改变。
                id: "blade-dancer.pay-cost",
                op: "cost.pay",
                args: {
                  // [A] 任意域 Power（163.2.b）：六域封闭集合下没有可执行值，保留描述性记号。
                  power: { kind: "constant", value: ["rainbow"] },
                  payments: {
                    kind: "constant",
                    value: [{ kind: "exhaust", object: "self" }]
                  }
                }
              },
              {
                // "to ready it"：it = 触发事件里被选中的那个友方单位（契约 3.6 缺事件对象选择符，
                // 该 TargetSpec 只是占位，见 judgeReason）。
                id: "blade-dancer.ready-chosen",
                op: "effect.ready",
                linkedTo: "blade-dancer.pay-cost",
                args: {
                  objects: {
                    kind: "constant",
                    value: { kind: "target", id: "blade-dancer.chosen-unit" }
                  }
                },
                targets: [
                  {
                    id: "blade-dancer.chosen-unit",
                    filter: { type: "unit", controller: "self", zone: "board" },
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
  },
  {
    kind: "triggered",
    // "When you conquer"：383.4.c.2.b 的 Conquer Effect（引用做出 Conquer 的玩家）。
    trigger: { at: "conquer", filter: { event: "conquer", player: "self" } },
    optional: true,
    body: [
      {
        id: "blade-dancer.may-ready-self",
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Pay :rb_energy_1: to ready Blade Dancer?" },
          body: {
            kind: "constant",
            value: [
              {
                id: "blade-dancer.pay-energy",
                op: "cost.pay",
                args: { energy: { kind: "constant", value: 1 } }
              },
              {
                // "ready me"：缺省选择即能力来源（412.4/416.1，effect.ready 的 source）。
                id: "blade-dancer.ready-self",
                op: "effect.ready",
                linkedTo: "blade-dancer.pay-energy",
                args: {}
              }
            ]
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-d511bb90ed51ac962aec938d769d68fb16ec0ef21f47c232f727712726e31cf1",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "（1）没有已合入的订阅方把 CardProgram 的 triggered ability 注册成 TriggerRegistration" +
    "（events/pipeline-types.ts 有类型，注册入口只在 chain/engine.ts 内部；同 darius-executioner/the-dreaming-tree 记录的缺口），" +
    "became-target（383.4.b.2）与 conquer（383.4.c.2.b）触发都还进不了链，属 RIFT-120（链/事件单管线）与引擎批 4；" +
    "（2）契约 3.6 的 ZoneId 没有 Legend Zone（CR 108.3），传奇不能表示为 Board 对象，415.5/415.4 的费用式「横置我」" +
    "与「ready me」缺少可执行的宿主表示（费用计划只接受 board/rune-zone 上的对象，cost/payment.ts 的 checkAction；同 ogn/the-boss）；" +
    "（3）「pay :rb_rune_rainbow:」是任意域（Universal）Power（135.2.e.5.b、163.2.b），Domain 是六域封闭集合，" +
    "effect.resources 明确记录 163.2.b 不可表达、绝不选一个域近似；" +
    "（4）cost.pay 没有已合入的原语文件（RIFT-9 清单内），费用计划的消费方属 RIFT-89；" +
    "（5）became-target 载荷只带链项控制者（chain/engine.ts 在 Finalize 目标锁定时发射），355.18 允许其他玩家代为做选择时" +
    "「做出选择的玩家」读不出来（RIFT-64 遗留的 targeting 载荷缺口）；" +
    "（6）「ready it」的 it 需要触发事件对象的绑定，契约 3.6 的 ObjectSelector（self/source/target/pick/linked）没有事件对象选择符。" +
    "依赖：RIFT-120、RIFT-89、RIFT-64，以及 legend-zone 与 Universal Power 的契约表达。不近似实现。",
  abilities,
  sourceText:
    "When you choose a friendly unit, you may exhaust me and pay :rb_rune_rainbow: to ready it.\n" +
    "When you conquer, you may pay :rb_energy_1: to ready me."
} satisfies CardProgram;

export default program;
