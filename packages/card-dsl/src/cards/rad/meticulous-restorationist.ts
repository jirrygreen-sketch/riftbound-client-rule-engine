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
 * status = judge-required（2026-10-17 复核）。条件满足后的「从 trash 打出本卡（Order 符文费）」
 * 用已合入的 `effect.play` + `"source"` 选择器 + 已 Finalize 费用计划表达，golden test 用参考内核真实执行。
 * 当前缺口（不近似实现）：
 * - 触发条件「you play a card with Energy cost :rb_energy_7: or more」需要读取被播下事件对象的
 *   印刷（基础）Energy 费用（206.1：判定费用时不看费用改写）。已合入的卡牌侧 `Condition`/`Expr`
 *   仍只能读静态选择器（self/source）或链接值，没有「读触发事件对象特征」的形式；
 *   events/timing-points.ts 的 card-played 时点也没有可被条件消费的载荷字段声明。
 * - 没有已合入路径把卡牌程序的 triggered 能力注册进事件管线并订阅 card-played：引擎不读取
 *   CardProgram 能力，testTrigger 适配器也没有宿主提供（RIFT-257 卡牌程序绑定仍在进行）。
 * 依赖：RIFT-257（卡牌程序绑定）、触发事件载荷与 condition 求值（RIFT-9 condition 组）。
 */
const program = {
  canonicalCardId: "card.hash-c53e9086202d34746759796f864fa5b794a4a294941dad556175a2e226acace5",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "2026-10-17 复核：条件满足后的「从 trash 打出本卡（Order 符文费）」已用 effect.play + 已 Finalize 费用计划" +
    "表达并且可执行（golden 有真实执行证据），不再把费用计划列为缺口。当前缺口两处：" +
    "(1) 触发条件「you play a card with Energy cost :rb_energy_7: or more」需要读取被播下事件对象的印刷" +
    "（基础）Energy 费用（206.1：判定费用时不看费用改写）：已合入的 Condition/Expr 只能读 self/source 等静态" +
    "选择器或链接值，card-played 时点也没有供条件消费的事件载荷字段；" +
    "(2) 没有已合入路径把 CardProgram 的 triggered 能力注册进事件管线并订阅 card-played" +
    "（引擎不读取卡牌程序能力，带 condition 的注册还要求宿主 testTrigger 适配器，均未合入；RIFT-257）。" +
    "依赖：RIFT-257、触发事件载荷 + condition 求值（RIFT-9 condition 组）。不近似实现。",
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
