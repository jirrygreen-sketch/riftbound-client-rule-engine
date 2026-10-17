import type { CardProgram } from "../../ir/index.js";

/**
 * Iascylla (unl-050-219) — Unit, 7 Energy + 1 Calm Power, Might 6，Calm，tag Bilgewater。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-050-219，逐字）：
 *   When I hold, at the start of your next Main Phase, you may move an enemy
 *   unit to this battlefield.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.d / 383.4.d.1 / 383.4.d.2.a：“When I hold …” 是 Hold Effect，即“条件包含
 *   某个单位在战场固守”的触发式能力；时点 hold（events/timing-points.ts，ruleRefs
 *   315.2.b.2 / 471.2 / 473.2.b，由 scoring/ 发出）。
 * - 391.2 / 391.4：“at the start of your next Main Phase” 描述延迟能力的时间窗
 *   （把被指示的动作推迟到你下一个 Main Phase 开始执行），既不是立即结算，也不能
 *   写成卡自身的 triggered ability：393 规定延迟能力由其他能力创建、不依附卡本体。
 * - 359.3.f.3.b 正是以本卡为例：“this battlefield” 指她固守的那个战场，该信息在
 *   触发条件满足、生成延迟触发时**锁定**，之后她移动/离场都不改变该次指代。
 * - 355.7 / 355.10：“an enemy unit” 是指定某个具体对象的 Choice，属选目标（targets）。
 * - 421.1 / 449.1：把单位移到另一个 Location 是 Move，由已合入的 effect.move 提交
 *   （不是 Recall，也不发生区域变更）。
 * - 355.5.b / 359.3.f.3.b：该延迟触发的选择（移动哪个敌方单位）在其 finalize 时
 *   才做出，因此 TargetSpec 随 choice.optional 节点声明，而不是在 hold 触发时锁定。
 *
 * status = judge-required（按当前 HEAD 复核；缺口不近似实现）：
 * - 卡牌侧延迟注册仍不可执行：解释器没有 trigger.delayed 的已注册指令实现，实测把
 *   本卡的原始 body 交给生产解释器即抛 Error "Unregistered instruction opcode: trigger.delayed"。
 *   内部 ResolveContext.registerDelayedTrigger 接缝（chain/engine.ts 注册 delayed 触发器）只有
 *   引擎内部调用方，没有任何 effects/instructions 消费它；卡牌无法自行创建延迟能力。
 * - “at the start of your next Main Phase” 的一次性窗口仍缺：封闭时点表只有 main-start，
 *   没有「控制者下一次 Main Phase 的 main-start」相对窗口，注册发生在固守结算（Beginning）后，
 *   同一回合的 main-start 无法区分。
 * - 「this battlefield」的固守地点仍无法锁定：hold 的 Score 波只有 player/details.battlefieldId
 *   （turn/flow.ts 的 scheduleScore），事件不带参与固守的单位对象，{ source: "self" } 订阅因此
 *   不会命中，359.3.f.3.b 要求的“生成延迟触发时锁定她固守的战场”没有来源。
 * 通用 source-location/linked-location 已合入；缺口是生产事件的参与单位与地点捕获，不能用
 * 结算时宿主的位置替代（359.3.f.3.b）。
 */

/**
 * 描述性目的地标记（不是可执行的 LocationRef）：“this battlefield” 只能在生成延迟
 * 触发时由触发条件锁定（359.3.f.3.b）。effect.move 的 destination() 只接受 base /
 * battlefield 字面量或候选列表，因此该形状会被明确拒绝而不是移动到猜测的地点。
 */
const THE_HELD_BATTLEFIELD = {
  kind: "destination-selector",
  referent: "iascylla-held-battlefield"
} as const;

export default {
  canonicalCardId:
    "card.hash-0167db5ef0a7cb8ad9866e8d7785e98b8be61001fe1303b0a80af41c6bdfffcc",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺：(1) trigger.delayed 的卡牌指令入口——effects/instructions 没有已注册实现，实测把本卡原始 body 交给生产解释器抛 " +
    "\"Unregistered instruction opcode: trigger.delayed\"；内部 registerDelayedTrigger 接缝只由引擎内部调用。" +
    "(2) 控制者下一次 main-start 的一次性窗口（CR 391.2/392/393）：封闭表只有 main-start，没有相对「下一个」Main Phase 的窗口，" +
    "而注册发生在固守结算（Beginning）之后，同一回合的 main-start 无法区分。" +
    "(3) hold 的 Score 波仅带 player/details.battlefieldId（turn/flow.ts），没有参与固守的单位对象，" +
    "{ source: \"self\" } 订阅不会命中，359.3.f.3.b 的「生成延迟触发时锁定她固守的战场」没有来源；" +
    "还需把该 battlefieldId 锁进延迟能力，以保持宿主随后移动或离场后的地点指代。" +
    "effect.move 本体与 355.5.b 的目标锁定已有执行证据（golden）。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        // 383.4.d.2.a：本卡的 Hold 能力在「本卡参与固守」时入链，
        // filter 用契约 3.6 的 source 锚点指称能力来源（sfd/rumble-scrapper 同型）。
        filter: { event: "held", filter: { source: "self" } }
      },
      // 383.3.a.3："you may" 不在触发效果的最开头（最开头是时间窗），由延迟触发在
      // 其 finalize/结算时决定；契约 3.9 要求把被选指令包进 choice.optional 的 body。
      optional: false,
      body: [
        {
          id: "iascylla.delayed-move",
          // 卡牌侧延迟触发声明：at/window/referent 记录印刷信息，body 是到点后要执行的指令；
          // 当前绑定仍缺少能消费这组窗口字段的生产适配。
          op: "trigger.delayed",
          args: {
            at: { kind: "constant", value: "main-start" },
            window: { kind: "constant", value: "next-main-phase" },
            referent: { kind: "constant", value: "iascylla-held-battlefield" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "iascylla.may-move",
                  op: "choice.optional",
                  args: {
                    prompt: {
                      kind: "constant",
                      value: "Move an enemy unit to this battlefield?"
                    },
                    body: {
                      kind: "constant",
                      value: [
                        {
                          id: "iascylla.move-enemy-unit",
                          op: "effect.move",
                          args: {
                            objects: {
                              kind: "constant",
                              value: { target: "iascylla.enemy-unit" }
                            },
                            to: { kind: "constant", value: THE_HELD_BATTLEFIELD },
                            amount: { kind: "constant", value: 1 }
                          }
                        }
                      ]
                    }
                  },
                  targets: [
                    {
                      id: "iascylla.enemy-unit",
                      // 355.9.a.1 / 355.9.b："an enemy unit" 是 Board 上由对手控制的单位。
                      filter: { type: "unit", zone: "board", controller: "opponent" },
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
  ],
  sourceText:
    "When I hold, at the start of your next Main Phase, you may move an enemy unit to this battlefield."
} satisfies CardProgram;
