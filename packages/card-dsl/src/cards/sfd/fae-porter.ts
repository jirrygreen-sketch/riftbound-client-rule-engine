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
 *   费用计划在 Finalize 检查），用 cost.pay 形状声明（RIFT-89 费用计划消费）。
 * - "move a unit you control to the same battlefield"：451 的效果移动（不是标准移动，不加
 *   144.2 的横置费用/主阶段门槛）；"a unit you control" 是选择的具体对象，属目标
 *   （355.10 / 355.9.a.1）；"the same battlefield" 是运行期 Location——能力来源当前所在的战场
 *   （"here" 的 referent，359.3.f.1：从来源读取、指令执行时检查、359.3.f.2）。
 *   已合入的 sfd/azir-sovereign（"to this battlefield"）用 condition.value 在结算时读出来源
 *   位置，再由 effect.move 的 to 经 linked-value 读取，该形状被原语接受。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - object-moved 触发缺可判定载荷：events/action-adapter.ts 为 move-location 生成的
 *   object-moved 事件带 object（被移动对象）但不填 toZone/toKind（timing-points.ts 声明的
 *   payloadFields），因此 toZone: "battlefield" 无法命中；events/pipeline-match.ts 只读
 *   EventPattern 的 object/source/target/player/fromZone/toZone/amount/details，不读取卡程序
 *   里的内层 filter 锚点，source: "self" 没有消费方（需把被移动对象与宿主的同一性暴露给卡牌
 *   注册层；449.1/449.2 的起终点、458 的 Recall 排除据此无法执行）。
 * - 费用侧 cost.pay 的 Chaos Power 支付属 RIFT-89 的费用计划批次（optionalAdditional 接线），
 *   参考内核不执行费用计划。
 * 正文的 effect.move + 来源位置 referent 形状可执行（与已合入 sfd/azir-sovereign 同型），
 * golden 用锁定目标真实执行；触发与费用不近似实现（不把任何移动都当作「移动到战场」，
 * 不省略 Chaos Power 费用）。
 * 依赖：RIFT-120（move-location 事件载荷与移动注册）、RIFT-89（费用计划接线）、RIFT-90（目标
 * 的 controller 占位符绑定）。
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
                  power: { kind: "constant", value: ["Chaos"] }
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
    "object-moved 触发没有可判定的「本卡移动」与「终点是战场」载荷：events/action-adapter.ts 的 move-location " +
    "映射生成的 object-moved 事件带 object（被移动对象）但不填 toZone/toKind（timing-points.ts 声明的 payloadFields），" +
    "因此 toZone: \"battlefield\" 无法命中；events/pipeline-match.ts 只读取 EventPattern 的 object/source/target/player/" +
    "fromZone/toZone/amount/details，不读取卡程序里的内层 filter 锚点，source: \"self\" 没有消费方" +
    "（需把被移动对象与宿主的同一性暴露给卡牌注册层；449.1/449.2 的起终点、458 的 Recall 排除据此无法执行）。" +
    "费用侧 1 点 Chaos 力量（163.1/163.2）的 cost.pay 需要费用计划消费方（Finalize 的 optionalAdditional 接线），" +
    "属 RIFT-89 批次；" +
    "目标的 controller: \"controller\" 占位符绑定同样依赖链的 query 归一化（chain/engine.ts 只归一化 self/opponent，" +
    "参考内核按值比较）。正文的 effect.move + 来源位置 referent（359.3.f.1）形状与已合入 sfd/azir-sovereign 同型，" +
    "golden 用锁定目标真实执行。依赖：RIFT-120（move-location 事件载荷与移动注册）、RIFT-89（费用计划）、RIFT-90（目标计划）。" +
    "不近似实现（不把任何移动都当作「移动到战场」，不省略 Chaos Power 费用，不手改位置）。",
  abilities,
  sourceText:
    "When I move to a battlefield, you may pay :rb_rune_chaos: to move a unit you control to the same battlefield."
} satisfies CardProgram;

export default program;
