import type { CardProgram } from "../../ir/index.js";

/**
 * Meticulous Restorationist (rad-120-167) — Gear, 2 Energy, Might 2, Order, Device.
 *
 * Printed text:
 *   When you play a card with Energy cost :rb_energy_7: or more, you may play me
 *   from your trash for :rb_rune_order:.
 *
 * 规则依据（CR v1.5）：
 * - “When you play a card …”：card-played 时点（383.4.a / 407）。触发条件里的“a card with
 *   Energy cost :rb_energy_7: or more”是触发条件的一部分（355.10.c：触发条件里的对象不是目标），
 *   按 206.1 用**基础费用**（base cost，忽略任何费用改写）判定，判定数值来自被播下的事件对象。
 * - “you may play me from your trash”：`choice.optional`（契约 3.9）包住被选指令；打出本卡用
 *   冻结的 `effect.play`（合同 GameAction "play"），对象引用是来源自身：静态 IR 用契约 3.6 的
 *   符号选择器 `"source"` 读其 `ref`，由解释器在结算时绑定（trash 是公开区域，355.10.a / 355.9.a
 *   允许以“your trash 里的卡”为目标，故此处不用 pick）。
 * - “for :rb_rune_order:”：一个 Order Domain 符文支付，体现为 `effect.play` 的已 Finalize 费用计划
 *   （`{ finalized: true, power: ["Order"] }`，与已合入 M1 卡同一形状）；已经 Finalize 的费用计划由
 *   打出动作收取，`effect.play` 不会自行推导印刷费用。
 * - “me from your trash”不是 Move（435.4.a），是打出动作：本卡离开 trash 打出后按 124 取得新的区域
 *   身份，旧引用失效（解释器负责，静态 IR 不写运行时 ObjectRef）。
 *
 * 缺口（不近似实现，故 judge-required）：
 * - 触发条件里“被播下的那张牌的 Energy cost ≥ 7”需要事件载荷把**该事件对象的基础 Energy 费用**
 *   带入条件求值；当前 `TriggerSpec.condition` 的 `Condition`/`Expr` 没有读取“触发事件对象及其印刷
 *   费用”的形式（`object-property` 只读静态选择器 `self`/`source`，读不到事件里的另一张牌）。
 * - 该能量阈值判定依赖 condition.predicate / condition.value 对事件载荷的落地（RIFT-9 清单
 *   condition 组；对应契约 3.5 触发消费的事件载荷），未合入前不能声称整卡可执行。
 *
 * 已可执行部分：条件满足后的“从 trash 打出本卡（Order 符文费）”这条效果链用 `effect.play` + `"source"`
 * 选择器 + 已 Finalize 费用计划表达，golden test 用参考内核真实执行；触发器与阈值条件用 `test.todo`。
 */
const program = {
  canonicalCardId: "card.hash-c53e9086202d34746759796f864fa5b794a4a294941dad556175a2e226acace5",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "触发条件“you play a card with Energy cost :rb_energy_7: or more”需要读取被播下事件对象的印刷" +
    "（基础）Energy 费用（206.1：判定费用时不看费用改写）：static IR 的 Condition/Expr 只能读 " +
    "self/source 等静态选择器，没有“读触发事件对象特征”的形式，因此阈值条件无法求值；" +
    "依赖 condition.predicate / condition.value 对事件载荷的支持（RIFT-9 清单 condition 组，" +
    "契约 3.5 事件载荷消费）未合入。条件满足后的“从 trash 打出本卡（Order 符文费）”已用 effect.play + " +
    "已 Finalize 费用计划表达并且可执行（单独测试）；不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", player: "controller" }
      },
      optional: true,
      body: [
        {
          id: "meticulous-restorationist.play-opt-in",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Play me from your trash for one Order rune?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "meticulous-restorationist.play-me",
                  op: "effect.play",
                  args: {
                    object: {
                      kind: "object-property",
                      object: "source",
                      property: "ref"
                    },
                    cost: {
                      kind: "constant",
                      value: { finalized: true, power: ["Order"] }
                    },
                    linkKey: { kind: "constant", value: "restored" }
                  }
                }
              ]
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "When you play a card with Energy cost :rb_energy_7: or more, you may play me from your trash for :rb_rune_order:."
} satisfies CardProgram;

export default program;
