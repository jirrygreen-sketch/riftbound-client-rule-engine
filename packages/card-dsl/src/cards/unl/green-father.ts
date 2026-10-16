import type { CardProgram } from "../../ir/index.js";

/**
 * Green Father (unl-195-219) — Legend, Calm/Order, tag Ivern.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-195-219，逐字）：
 *   When you conquer or hold, you may exhaust me to replace that battlefield with
 *   a Brush battlefield token. (Bird, Cat, Dog, Poro, and Ivern units have +1
 *   :rb_might: in Brush. It can be swapped back when scored.)
 *
 * 规则依据（CR v1.5）：
 * - 383.4.c / 383.4.c.1 / 383.4.c.2.b：「When you conquer」是 Conquer Effect，引用
 *   「执行征服的玩家」的能力在控制者完成征服时进链，时点用封闭表的 conquer
 *   （events/timing-points.ts，refs 468.5.d / 471.1 / 473.2.a；由 turn/flow.ts 的
 *   计分波发出）。383.4.c.2.c：征服的点数被否定或替代时照常触发。
 * - 383.4.d / 383.4.d.1 / 383.4.d.2.b：同一句里的「hold」是 Hold Effect，时点 hold
 *   （refs 315.2.b.2 / 471.2 / 473.2.b，同样由 turn/flow.ts 的计分波发出）。
 *   「conquer or hold」是两个独立触发条件，因此写成两条 triggered 能力，不合并成
 *   一个自定义时点。
 * - 383.3.a / 403.1：效果开头的「you may」是触发能力自身的 Finalize 决定，由
 *   TriggeredAbility.optional 承载；契约 3.9 要求「可以……」把被选指令包进
 *   choice.optional 的 body，不使用 choice + linkedTo 的写法。
 * - 383.3.b / 204.3 / 355.10.c.1：紧跟「you may」的「exhaust me」是触发能力的基础费用
 *   （cost within instructions），必须能完成（415.4 / 415.5）才能把触发放进链；这类
 *   费用不产生目标，所以是引用来源自身的非目标选择。
 * - 187.8：Brush 是「无域战场 token」，带「Bird/Cat/Dog/Poro/Ivern units here have
 *   +1 [M]」与「When you score here, you may replace this with the battlefield it
 *   replaced.」自身能力。439.1 / 439.3：「Replace [X] with [Y]」是 Replace 行动
 *   （有限行动，439.2），被替代的牌进入 Banishment（439.5），token 可在计分时
 *   Swap Back（439.7）。359.3.f.1「that battlefield」指触发事件里的那个战场。
 *
 * status = judge-required（缺口不近似实现）：
 * - 缺 Replace 行动的可执行路径：契约 3.6 的封闭 GameAction 集合没有 replace，
 *   effects/instructions/ 下也没有对应原语；本程序用未注册的 effect.replace 记录
 *   439.3 的「Replace [X] with [Y]」形状，任何执行路径都会以未注册 opcode 失败
 *   （不近似成 move-zone / create-token / 手改战场）。
 * - 缺 Brush 战场 token 定义：187.8 的 Brush 是「带自身能力的战场 token」，而
 *   effect.token 的冻结定义表（recruit / sand-soldier / mech / reflection / tentacle）
 *   只有无额外能力的单位 token，并明确把需要其他能力的定义保持 blocked；
 *   439.5 的 Banishment 与 439.7 的 Swap Back 追踪同样未合入。
 * - 「that battlefield」需要触发事件（conquer / hold 载荷）中的战场身份：合并
 *   TriggerSpec/EventPattern 只有 object/source/target/player/fromZone/toZone/amount/
 *   details，conquer/hold 的载荷只带 battlefieldId（timing-points.ts 未声明
 *   payloadFields），body 里没有可绑定的战场选择器，本程序保留可审查的占位常量。
 * - 「exhaust me」的基础费用语义与「me」的 Legend Zone 归属同 Gloomist：契约 3.1 的
 *   TriggeredAbility 没有 cost 槽位，ZoneId 也没有 legend-zone（CR 107.4.a/c），
 *   cost/payment.ts 的 exhaust 费用只接受 board / rune-zone 的支付对象。
 * effect.exhaust 的非目标选择形状与 effect.replace 的声明已按现契约编码，
 * golden 用参考内核真实执行横置半段，其余缺口保持 test.todo。
 *
 * 依赖：Replace 行动原语与 Brush 战场 token 定义（契约变更：GameAction/定义表）、
 * RIFT-89（触发能力基础费用接线）、契约补充 legend-zone、引擎批 4（事件载荷绑定）。
 */
const greenFather = {
  canonicalCardId:
    "card.hash-cbd7d8a764f8a0a4bf62c8365cd14d5dd5deb06823365bffea237f2d3dd757a6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口，均不近似实现：(1) 缺 Replace 行动的可执行路径——CR 439.1/439.3 的「Replace [X] with [Y]」是有限行动，" +
    "契约 3.6 的封闭 GameAction 集合没有 replace，effects/instructions/ 下也没有对应原语；本程序用未注册的 effect.replace 记录形状，" +
    "任何执行路径都会以未注册 opcode 失败，不近似成 move-zone / create-token / 手改战场。" +
    "(2) 缺 187.8 的 Brush 战场 token 定义：effect.token 的冻结定义表（recruit/sand-soldier/mech/reflection/tentacle）只有无额外能力的单位 token，" +
    "并明确把带自身能力的定义保持 blocked；439.5 的 Banishment 与 439.7 的 Swap Back 追踪同样未合入。" +
    "(3)「that battlefield」需要触发事件载荷里的战场身份：合并 TriggerSpec/EventPattern 只有 object/source/target/player/fromZone/toZone/amount/details，" +
    "conquer/hold 时点（timing-points.ts）未声明 payloadFields，body 没有可绑定的战场选择器，本程序保留占位常量并标注。" +
    "(4)「exhaust me」按 CR 383.3.b/204.3 是触发能力的基础费用，契约 3.1 的 TriggeredAbility 没有 cost 槽位；且「me」是 Legend Zone 中的传奇" +
    "（CR 107.4.a/107.4.c），契约 ZoneId 没有 legend-zone，cost/payment.ts 的 exhaust 费用只接受 board/rune-zone。" +
    "conquer/hold 时点（由 turn/flow.ts 计分波发出）、effect.exhaust 与解释器路径已合入，golden 真实执行横置半段。" +
    "依赖：Replace 行动原语与 Brush token 定义（契约变更）、RIFT-89（触发能力基础费用接线）、契约补充 legend-zone、引擎批 4（事件载荷绑定）。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        // 383.4.c.2.b：「引用执行征服的玩家」的 Conquer Effect。
        filter: { event: "conquer", player: "self" }
      },
      // 383.3.a / 403.1：效果开头的「you may」是触发自身的 Finalize 决定。
      optional: true,
      body: [
        {
          id: "green-father.conquer-may",
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Exhaust me to replace that battlefield with a Brush battlefield token?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  // 383.3.b 的基础费用形状（355.10.c.1：费用不产生目标；真实费用在
                  // Finalize 支付，见 judgeReason）。
                  id: "green-father.conquer-exhaust-self",
                  op: "effect.exhaust",
                  args: {
                    choose: {
                      kind: "constant",
                      value: {
                        id: "green-father.conquer-exhaust-self",
                        filter: { object: "self" }
                      }
                    }
                  }
                },
                {
                  // 「to replace that battlefield with …」：只有费用成立才执行
                  // （359.3.e.14 的链接语义）。439.3.a 的 [X] 是「该战场」——合并 IR 没有
                  // 事件载荷选择器，占位常量仅记录形状（见 judgeReason；任何执行路径都会
                  // 因 effect.replace 未注册而失败）。
                  id: "green-father.conquer-replace",
                  op: "effect.replace",
                  linkedTo: "green-father.conquer-exhaust-self",
                  args: {
                    battlefield: {
                      kind: "constant",
                      value: { type: "battlefield", id: "that-battlefield" }
                    },
                    // 439.3.b.1： [Y] 永远是「要创建的 token」；187.8 的 brush 定义未合入。
                    withToken: { kind: "constant", value: "brush" }
                  }
                }
              ]
            }
          }
        }
      ]
    },
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        // 383.4.d.2.b：「引用执行固守的玩家」的 Hold Effect。
        filter: { event: "hold", player: "self" }
      },
      optional: true,
      body: [
        {
          id: "green-father.hold-may",
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Exhaust me to replace that battlefield with a Brush battlefield token?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "green-father.hold-exhaust-self",
                  op: "effect.exhaust",
                  args: {
                    choose: {
                      kind: "constant",
                      value: {
                        id: "green-father.hold-exhaust-self",
                        filter: { object: "self" }
                      }
                    }
                  }
                },
                {
                  id: "green-father.hold-replace",
                  op: "effect.replace",
                  linkedTo: "green-father.hold-exhaust-self",
                  args: {
                    battlefield: {
                      kind: "constant",
                      value: { type: "battlefield", id: "that-battlefield" }
                    },
                    withToken: { kind: "constant", value: "brush" }
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
    "When you conquer or hold, you may exhaust me to replace that battlefield with a Brush battlefield token. " +
    "(Bird, Cat, Dog, Poro, and Ivern units have +1 :rb_might: in Brush. It can be swapped back when scored.)"
} satisfies CardProgram;

export default greenFather;
