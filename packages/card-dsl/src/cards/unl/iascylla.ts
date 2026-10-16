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
 * status = judge-required（缺口不近似实现）：
 * - 缺「注册延迟触发」的卡牌侧原语：RIFT-9 清单中的 trigger.delayed 没有已注册的
 *   InstructionDef（effects/instructions/ 只有 effect.* 文件），ResolveContext.
 *   registerDelayedTrigger 只有引擎内部调用方，卡程序无法订阅「下一个 Main Phase
 *   开始」；TriggerSpec.once 也只有 per-turn/per-combat/per-chain/per-game，
 *   没有「next time / 下一步阶段」窗口。
 * - “this battlefield” 是触发条件在生成延迟触发时锁定的 referent（359.3.f.3.b），
 *   合并 ObjectSelector 只有 self/source/target/pick/linked，没有事件/条件 referent；
 *   程序里的目的地只是描述性标记，解释器按 effect.move 的目的地校验会拒绝它，
 *   不会把敌方单位移到错误地点。
 * /args 的 trigger.delayed 及其 body 按 RIFT-9 清单与本仓既有写法
 * （ogn/targons-peak、ogn/imperial-decree）保留可审查结构；被推迟的
 * “move an enemy unit to（一个战场）”子指令本身用已合入的 effect.move，golden 测试
 * 用真实解释器 + 参考内核执行它（目的地按 359.3.f.3.b 由触发条件锁定后传入）。
 *
 * 依赖：引擎批 4/5 的延迟触发注册（trigger.delayed）与触发条件 referent 选择器。
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
    "缺延迟触发注册与触发条件 referent：（1）「at the start of your next Main Phase」是延迟能力的时间窗（CR 391.2/391.4、393），" +
    "但 RIFT-9 清单里的 trigger.delayed 没有已注册的 InstructionDef，effects/instructions/ 只有 effect.* 文件，" +
    "ResolveContext.registerDelayedTrigger 只有引擎内部调用方，TriggerSpec.once 也没有『下一步阶段 / next time』窗口，" +
    "卡程序无法订阅『你的下一个 Main Phase 开始』。（2）「this battlefield」按 359.3.f.3.b（规则书正以本卡为例）是触发条件在生成延迟触发时锁定的 referent，" +
    "合并 ObjectSelector 只有 self/source/target/pick/linked，没有事件/条件 referent；程序里的目的地是描述性标记，" +
    "解释器会按 effect.move 的目的地校验拒绝它，不会把敌方单位移到错误地点。" +
    "被推迟的 effect.move 子指令本身已合入并由 golden 用真实解释器 + 参考内核执行（目的地按 359.3.f.3.b 由触发条件锁定后传入）。" +
    "依赖：引擎批 4/5 的延迟触发注册（trigger.delayed）与触发条件 referent 选择器；不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        // 383.4.d.2.a：本卡的 Hold 能力在「本卡参与固守」时入链，
        // filter 用契约 3.6 的 source 锚点指称能力来源（sfd/rumble-scrapper 同型）。
        filter: { event: "hold", filter: { source: "self" } }
      },
      // 383.3.a.3："you may" 不在触发效果的最开头（最开头是时间窗），由延迟触发在
      // 其 finalize/结算时决定；契约 3.9 要求把被选指令包进 choice.optional 的 body。
      optional: false,
      body: [
        {
          id: "iascylla.delayed-move",
          // RIFT-9 清单中的延迟触发注册（未注册 op，见 judgeReason）：
          // at/window/referent 记录印刷信息，body 是到点后要执行的指令。
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
