import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Transpositionist (rad-115-167) — Unit, 6 Energy, Might 4, Chaos.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, rad-115-167，逐字）：
 *   ":rb_rune_chaos:, :rb_exhaust:: Return a friendly unit to its owner's hand.
 *    You may play a unit with less Might than that unit had, ignoring its cost."
 *
 * 规则依据（CR v1.5）：
 * - 145.1 / 145.2 / 376 / 377 / 381：":rb_rune_chaos:, :rb_exhaust::" 是启动能力
 *   费用（1 Chaos 符文 + 横置自身）；契约 3.1 的 activated 用 cost + body。
 * - 355.5 / 355.9："a friendly unit" 是玩家必须选定的对象 → 选目标（"Return a unit
 *   … to its owner's hand" 的目标是那个单位；355.9.a.1 的 "unit" 默认指 Board 上的
 *   单位）。区域迁移经封闭 GameAction return-to-hand（契约 3.6），由 effect.zone 提交；
 *   055/359.3.e 的部分失效由原语处理。
 * - "You may play a unit …" 是结算时的可选决定（契约 §3.9：choice.optional 把被选择
 *   的指令包在 body 里）。
 * - "with less Might than that unit had"：比较对象是被返回单位**离开 Board 之前**的
 *   最后已知 Might（359.3.e.13 / 128 的最后已知信息）；Amount 动态读取该单位的 Might，
 *   用 object-property 作用于 target 选择器（契约 3.6 的符号选择器，默认取最后已知）。
 * - "ignoring its cost"：356.1.b.1 把被忽略的 base Energy cost 与 Power cost 一起置空；
 *   忽略费用必须由费用管线按 356.1.b 的规则生成 finalized 计划（420.3.b.1）。
 *
 * status = judge-required（README 第 2 节）。缺口，均不近似实现：
 * 1. 「ignoring its cost」没有生产路径：费用指令 cost.pay / cost.modify 已合入，但
 *    cost.modify 的 ignoreAllCosts 只能由打出/激活流程传入 source 参数，当前唯一调用方
 *    是 Weaponmaster；为选定手牌单位生成「印刷 Energy 与 Power 全清零」的 Finalize 计划
 *    仍没有打出侧调用方（effect.play 本身只消费已 Finalize 计划，不实现 ignored-cost 规则）。
 * 2. 「a unit with less Might than that unit had」是 Finalize 时的动态目标过滤：候选牌
 *    在手里（355.10.a 的私有区域，不能当目标 → 用 pick），其资格取决于与被返回单位
 *    最后已知 Might 的比较；已合入的 TargetSpec/PickSpec filter 只有静态等值/集合键，
 *    没有「候选牌的 Might < 另一对象的 Might」这种跨对象动态比较（同 ogn/kaisa-evolutionary
 *    记录的动态过滤缺口）。
 * 3. 打出位置："Play a unit" 的合法位置由 355.2.a/355.2.b 在 Finalize 决定（默认基地或
 *    己方控制的战场），effect.play 的 location 需要调用方给出具体 LocationRef；静态 IR 给
 *    不出，写死 基地/某个战场都会改变卡牌语义。
 * 已按已合入原语写出的部分（golden 测试真实执行）：effect.zone 把友方单位移回拥有者
 * 手牌 + choice.optional（拒绝即跳过）+ 用 target 选择器的最后已知 Might 做 compare
 * 门控的 effect.play 形状。依赖：ignoreAllCosts 的打出侧调用方、动态目标过滤与打出位置。
 */
const abilities: Ability[] = [
  {
    kind: "activated",
    cost: {
      power: { kind: "constant", value: ["Chaos"] },
      payments: [
        // 415.5 / 415.3.a：横置符号 = cost.exhaust（“Exhaust me”）。
        { kind: "exhaust" }
      ]
    },
    timing: "action",
    body: [
      {
        // 355.9 / 355.9.a.1："a friendly unit" 选一个己方单位；区域迁移由已合入的
        // effect.zone 提交 return-to-hand（契约 3.6 的封闭 GameAction）。
        id: "transpositionist.return-friendly",
        op: "effect.zone",
        args: {
          target: { kind: "constant", value: "transpositionist.friendly-unit" },
          to: { kind: "constant", value: "hand" },
          amount: { kind: "constant", value: 1 }
        },
        targets: [
          {
            id: "transpositionist.friendly-unit",
            filter: { type: "unit", controller: "controller", zone: "board" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      },
      {
        id: "transpositionist.may-play",
        op: "choice.optional",
        linkedTo: "transpositionist.return-friendly",
        args: {
          prompt: {
            kind: "constant",
            value: "Play a unit with less Might, ignoring its cost?"
          },
          body: {
            kind: "constant",
            value: [
              {
                // 「a unit with less Might than that unit had」：比较手牌候选的 Might
                // 与刚被返回单位的 Might（target 选择器在默认回看下取最后已知信息，
                // 359.3.e.13/128）。条件不满足时这条打出指令被跳过（契约 3.4 的
                // condition 作用范围只限本条指令）。
                id: "transpositionist.play-cheaper",
                op: "effect.play",
                condition: {
                  kind: "compare",
                  left: {
                    kind: "object-property",
                    object: { pick: "transpositionist.cheaper-unit" },
                    property: "might"
                  },
                  operator: "lt",
                  right: {
                    kind: "object-property",
                    object: { target: "transpositionist.friendly-unit" },
                    property: "might"
                  }
                },
                args: {
                  pick: { kind: "constant", value: "transpositionist.cheaper-unit" },
                  // 356.1.b.1 的 "ignoring its cost"：需要由费用管线按被选单位的印刷
                  // 费用生成 ignoreAllCosts 计划（见 judgeReason 第 1 点）；静态 IR 只
                  // 声明“已 Finalize 的零计划”形状，不声称覆盖 Power 清零。
                  cost: { kind: "constant", value: { finalized: true, energy: 0, power: [], xp: 0 } }
                },
                picks: [
                  {
                    id: "transpositionist.cheaper-unit",
                    // 355.10.a：手牌是私有区域，所以这是 pick（非目标选择）而不是 target；
                    // 「less Might」的跨对象比较是上述 judged 部分。
                    options: ["dynamic:units-in-controller-hand"],
                    filter: { type: "unit", zone: "hand", owner: "controller" },
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

export default {
  canonicalCardId: "card.hash-29039a01e010e05c672135f4eecdce0272b117de9fa9ef982dc8f57634cb6e6d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) 「ignoring its cost」没有生产路径——cost.pay / cost.modify 已合入，" +
    "但 cost.modify 的 ignoreAllCosts 只能由打出/激活流程传入 source 参数，当前唯一生产调用方是" +
    " Weaponmaster 的目标选择器形式（cost.modify.ts 头部注记）；" +
    "按 356.1.b.1 为选定手牌单位生成「base Energy 与 Power 全清零」的 Finalize 计划仍没有打出侧调用方" +
    "（effect.play 只消费已 Finalize 计划，不实现 ignored-cost 规则），静态 IR 也给不出该计划；" +
    "(2) 「a unit with less Might than that unit had」是 Finalize 时的跨对象动态过滤：候选牌在手牌（355.10.a 私有区域 → pick，" +
    "不是 target），其资格取决于与被返回单位最后已知 Might（359.3.e.13/128）的比较，已合入的 filter 只有静态等值/集合键；" +
    "(3) 「Play a unit」的合法位置由 355.2.a/355.2.b 在 Finalize 决定，effect.play 的 location 需要具体 LocationRef，静态 IR 给不出。" +
    "已写出并有 golden 真实执行的部分：effect.zone 把友方单位移回拥有者手牌、choice.optional 的接受/拒绝、" +
    "以及由 compare 条件门控的 effect.play 形状。依赖：ignoreAllCosts 的打出侧调用方、动态过滤与打出位置。",
  abilities,
  sourceText:
    ":rb_rune_chaos:, :rb_exhaust:: Return a friendly unit to its owner's hand. " +
    "You may play a unit with less Might than that unit had, ignoring its cost."
} satisfies CardProgram;
