import type { CardProgram } from "../../ir/index.js";

/**
 * Rebuttal (ven-152-166) — Spell, 1 Energy + 1 Mind/Chaos Power, tags Mel/Signature.
 * Might null（法术没有印刷 Might）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-152-166，逐字）:
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)
 *    Choose a spell with Energy cost no more than :rb_energy_4:.  You may pay
 *    :rb_rune_rainbow:. If you do, gain control of it and you may make new
 *    choices for it. Otherwise, counter it."
 *
 * 规则依据（CR v1.5）:
 * - [Reaction]（813.1.c.1）是许可类关键词：可在任意玩家回合的 Closed State 打出；卡只声明关键词，
 *   展开与准入由关键词注册表与 chain 负责（契约 3.7 / 3.5）。
 * - 「Choose a spell」：355.9.a.2 规定 "spell" 指链上已 Finalize 的对象，因此这是链上目标的
 *   TargetSpec；待结算的 Pending 链项不是合法目标（契约 3.4 / 355.3），法术也不能以自身为目标
 *   （355.9.c）——两者的校验义务在目标计划与链，不在卡数据。
 * - 「with Energy cost no more than :rb_energy_4:」：206 / 206.1 规定判断费用时只看印刷（或用复制
 *   效果后的复制）费用，忽略已支付的追加费用——Defy 正是该条自带的示例。冻结的 TargetSpec 过滤器
 *   无法读取链上法术的印刷 Energy 费用，因此限制以描述性键保留（见 judgeReason），绝不去掉限制。
 * - 「You may pay :rb_rune_rainbow:」：:rb_rune_rainbow: 是任意域 Power [A]（135.2.e.5.a、
 *   163.2.b）；已合入的 cost.pay 以 payments.power 数值 1 表达 [A]，并写入可由
 *   linked-value 读取的支付回执。
 * - 「If you do, gain control of it」：控制权变更由已合入的 effect.control 经冻结的 take-control
 *   动作执行（RIFT-117）；链上法术的控制层改写与 359.3.e 的引用复核由该原语负责。
 * - 「and you may make new choices for it」：CR 750-755 的 Making New Choices 流程（752.1 只允许
 *   重选 location/mode/destination/target，753/753.3 要求全部重选并沿用原限制，753.2 没有合法新选择时
 *   negated，754 重新触发成为目标，755 忽略因此产生的 to-play 费用）；IR 既没有重开已 Finalize 链项
 *   选择计划的节点，也没有 753.2 的结果绑定。按契约 3.9 用 choice.optional 把该从句包进 body。
 * - 「Otherwise, counter it」：未支付时反制该法术（426.1-426.3：被反制的牌不产生效果、离开链、费用
 *   不退还），由已合入的 effect.counter 执行；支付回执和两路 body 已能写入 IR，实际打出仍受
 *   choice.mode 的 Finalize/Resolve choice-plan 适配器阻断。
 *
 * 当前状态与剩余接线见 judgeReason；不以原语存在代替整卡执行证据。
 */

/** 355.12：may 动作的目标选择与是否执行该动作无关，因此在 Finalize 一并锁定同一个法术目标。 */
const CHOSEN_SPELL = "rebuttal.chosen-spell";

const rebuttal = {
  canonicalCardId: "card.hash-a4302d5534972d519025714467e05c69796d7a87f0fa2b4fc17978846a4f1df9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口：(1) CR 206 的印刷或复制 Energy <= 4 目标限制 energyMax 未被 programs/filters.ts 或 target/target-plan.ts 消费；event-printed 只读事件特征，不能替代链上目标过滤。(2) choice.mode 已能在解释器运行，但 programs/play.ts 与 chain/engine.ts 仍缺 Finalize/Resolve choice-plan 适配器。cost.pay 的 payments.power 已可规划 [A] 并产出支付回执，成功回执写在 payment；支付失败抛错并中止 body，因此控制分支依序链接支付，不读取不存在的顶层 paid。(3) CR 750-755 的 choice.remake-chain-item-choices 与已 Finalize 链项计划重建仍未实现：752.1 仅重选 location/mode/destination/target，753/753.3 全部重选且沿用限制，753.2 无合法选择则 negated，754 再触发成为目标，755 忽略新增 to-play 费用。通用地点选择和 condition.result 已合入，缺的是上述组合接线。不近似实现。",
  abilities: [
    // 813.1.c.1：印刷的 [Reaction] 只声明，展开与 Closed State 准入归关键词注册表与 chain。
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      body: [
        {
          // 「Choose a spell with Energy cost no more than :rb_energy_4:.」——355.12：目标选择
          // 与结算时的支付分支无关，因此 TargetSpec 挂在这一层并在 Finalize 锁定一次；choice.mode
          // 记录“支付并取得控制”与“否则反制”两路互斥结果。
          id: "rebuttal.payment-branch",
          op: "choice.mode",
          args: {
            chooser: { kind: "constant", value: "controller" },
            count: { kind: "constant", value: 1 },
            different: { kind: "constant", value: true },
            prompt: { kind: "constant", value: "Pay :rb_rune_rainbow: or counter that spell?" },
            modes: {
              kind: "constant",
              value: [
                {
                  id: "rebuttal.pays-rainbow",
                  body: [
                    {
                  // 结算期支付 [A]：135.2.e.5.a / 163.2.b 的任意域 Power 由数值 1 表达；
                  // cost.pay 失败抛错；成功后才按 linkedTo 继续取得控制。
                  id: "rebuttal.pay-rainbow",
                  op: "cost.pay",
                  args: {
                    payments: { kind: "constant", value: { power: 1 } }
                  }
                    },
                    {
                  // 「gain control of it」：链上法术（355.9.a.2）的控制层改写经冻结的 take-control
                  // 动作执行（RIFT-117），引用复核仍在链上由原语按 359.3.e 完成。
                  id: "rebuttal.gain-control",
                  op: "effect.control",
                  linkedTo: "rebuttal.pay-rainbow",
                  args: {
                    objects: { kind: "constant", value: { target: CHOSEN_SPELL } },
                    amount: { kind: "constant", value: 1 },
                    linkKey: { kind: "constant", value: "rebuttal-controlled" }
                  }
                    },
                    {
                  // 「you may make new choices for it」：CR 750-755 的重选从句，按契约 3.9 包进
                  // choice.optional 的 body；重选节点本身仍未注册（见 judgeReason 第 3 点）。
                  id: "rebuttal.may-remake-choices",
                  op: "choice.optional",
                  linkedTo: "rebuttal.gain-control",
                  args: {
                    prompt: {
                      kind: "constant",
                      value: "Make new choices for that spell?"
                    },
                    body: {
                      kind: "constant",
                      value: [
                        {
                          id: "rebuttal.remake-choices",
                          op: "choice.remake-chain-item-choices",
                          args: {
                            // 752.1：可重选的是 location / mode / destination / target；753 要求全部重选。
                            item: { kind: "constant", value: { linked: "rebuttal.gain-control" } },
                            choices: {
                              kind: "constant",
                              value: ["location", "mode", "destination", "target"]
                            },
                            remakeAll: { kind: "constant", value: true }
                          }
                        }
                      ]
                    }
                  }
                    }
                  ]
                },
                {
                  id: "rebuttal.counter-branch",
                  body: [
                    {
                      id: "rebuttal.counter-otherwise",
                      op: "effect.counter",
                      args: { target: { kind: "constant", value: CHOSEN_SPELL } }
                    }
                  ]
                }
              ]
            }
          },
          targets: [
            {
              id: CHOSEN_SPELL,
              // 355.9.a.2："spell" 指链上已 Finalize 的对象；206 的印刷费用限制以描述性键
              // energyMax 保留——没有任何已合入谓词求值它（见 judgeReason 第 1 点），
              // 因此该目标当前不会被合法 Finalize，绝不当成已实现。
              filter: { type: "spell", zone: "chain", energyMax: 4 },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Choose a spell with Energy cost no more than :rb_energy_4:.  You may pay :rb_rune_rainbow:. " +
    "If you do, gain control of it and you may make new choices for it. Otherwise, counter it."
} satisfies CardProgram;

export default rebuttal;
