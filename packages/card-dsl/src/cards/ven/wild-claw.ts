import type { CardProgram } from "../../ir/index.js";

/**
 * Wild Claw（ven-089-166）— Spell，7 Energy + 1 Body Power，领域 Body。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-089-166，逐字）：
 *   "Look at the top 5 cards of your Main Deck. You may banish a unit or gear
 *    from among them and play it, reducing its Energy cost by :rb_energy_5:.
 *    Recycle the rest. Then you may do this: Empower it. (It becomes Empowered if
 *    it's not already.)"
 *
 * 规则依据（Core Rules v1.5）：
 * - "Look at the top 5 cards of your Main Deck"：effect.inspect 的 top 作用域（128.3–128.4 look
 *   只向查看者披露；432.1.c 尽可能查看、不 Burn Out）。牌库顺序必须来自上游有序 picks（契约 3.6
 *   的 zoneSlice 语义）——原语明确不用 query 推断牌库顺序，缺有序来源时按 negated/impossible 阻断。
 * - "You may banish a unit or gear from among them and play it"：被看的牌在主牌库（非公开区域），
 *   按 355.10.a 不是 Target；它是 "Pick"（355.7），因此用 effect.inspect 的结算期非目标选择
 *   （choose + chooseCount）而不是 TargetSpec。"then play it" 用 linkedTo 读取 banish 收据里的
 *   换区后新引用（124：换区产生新身份，旧 zoneEntryId 引用失效）。"You may" 按契约 3.9 把
 *   banish + play 两条被选指令包进同一个 choice.optional 的 body。
 * - "reducing its Energy cost by :rb_energy_5:"：打出该牌时对其基础费用的改写（356.1.c 引用
 *   印刷基础费用；356.6 Energy 费用不得低于 0）。
 * - "Recycle the rest."：effect.recycle 于同一已看牌列表（417.1.a 回收到拥有者主牌库底部；
 *   417.4 尽可能回收）；已被放逐/打出的牌旧引用失效，因此天然只剩"其余"。
 * - "Then you may do this: Empower it."：第二个可选指令（契约 3.9 的 choice.optional），对刚打出、
 *   现在在 Board 上的那个永久物执行 Empower。442.2 规定 Empowered 是 Board 上对象的状态；
 *   442.1.b / 442.1.c 的"已 Empowered 则什么都不发生"由动作层负责（effect.empower 文档记录同一分工）。
 *
 * status = judge-required（三处缺口，均不近似实现）：
 * 1. 减费的动态费用计划仍无生产者：已合入 cost.modify 可构造修改后的费用计划，但 effect.play 要求
 *    传入费用系统产出的已 Finalize 的 FinalizedCostPlan；当前卡牌 IR 不能从被选牌读取其印刷费用并完成该计划。
 * 2. "Empower it" 的目标引用没有生产者：effect.play 只把实际打出的张数写进链接值（数字），
 *    没有暴露被打出对象的 Board 新引用；banish 收据里的引用在打出后即失效（124），所以拿不到 "it"。
 *    而且卡牌侧 effect.empower 的 objects 参数只接受 source/target/pick/query/choose/显式引用列表，
 *    不接受契约 3.2 的 { linked: id } 选择器，因此该分支连数据都写不成可执行的"引用前序结果"形态。
 * 3. "a unit or gear from among them" 的类型限制没有消费方：effect.inspect 的结算期 choose 只是对已查看
 *    集合做非目标选择，不读取 PickSpec.filter，因此 unit/gear 限制无法在执行期生效（程序里的 filter 是
 *    描述性记录，不能被当成已实现）。有序 top picks 的生产与过滤消费仍缺少执行期消费者。
 * 依赖：动态费用计划/FinalizedCostPlan 生产、effect.play 的对象收据与 Empowered 条件路径、有序 picks 与过滤消费。
 */
const wildClaw = {
  canonicalCardId: "card.hash-28f97aabe7a3a4dfd6dae43c8b97140d885896c00f5daa8175c00a2e9b0a9d64",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1)「play it, reducing its Energy cost by :rb_energy_5:」需要按 356.1.c/356.6 在打出该牌时改写其印刷基础费用（Energy -5，且不得低于 0）：" +
    "已合入的 cost.modify 只能改写费用计划；effect.play 仍要求费用系统产出的已 Finalize 的 FinalizedCostPlan，当前卡牌 IR 没有被选牌印刷费用的动态计划生产者。" +
    "(2)「Then you may do this: Empower it」的 it 没有引用生产者：effect.play 只链接实际打出的张数（数字），没有暴露被打出永久物的 Board 新引用；" +
    "banish 收据里的引用在打出后失效（124），且卡牌侧 effect.empower 的 objects 不接受契约 3.2 的 { linked: id } 选择器，故该分支未写成可执行形态。" +
    "(3)「a unit or gear from among them」的类型限制无消费方：effect.inspect 的结算期 choose 不读取 PickSpec.filter，描述性 filter 键不会被任何已合入过滤器消费" +
    "因此不能声称该限制已生效。依赖：动态费用计划/FinalizedCostPlan 生产、effect.play 的对象收据与 Empowered 条件路径、有序 picks 与过滤消费。不近似实现。",
  abilities: [
    {
      kind: "play",
      // 印刷费用 7 Energy + 1 Body Power；power 为印刷值（catalog power=1, domains ["Body"]）。
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 7 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          // "your Main Deck" 的 "you" = 能力控制者（190.6.d）。effect.inspect 的 player 实参要求运行时
          // PlayerId；先把控制者作为数据值绑定一次，再用 linked-value 读回（同 ogn-062-298 Reinforce）。
          id: "wild-claw.bind-controller",
          op: "condition.value",
          args: {
            value: {
              kind: "object-property",
              object: "source",
              property: "controller"
            },
            key: { kind: "constant", value: "controller" }
          }
        },
        {
          // "Look at the top 5 cards of your Main Deck" + "You may banish a unit or gear from
          // among them"：一次私下查看（128.3–128.4），选择是结算期非目标选择（355.10.a / 355.18），
          // 0 或 1 张。
          id: "wild-claw.look-top-five",
          op: "effect.inspect",
          args: {
            player: {
              kind: "linked-value",
              instructionId: "wild-claw.bind-controller",
              key: "controller"
            },
            zone: { kind: "constant", value: "deck" },
            scope: { kind: "constant", value: "top" },
            amount: { kind: "constant", value: 5 },
            picksSpecId: { kind: "constant", value: "wild-claw.top-five" },
            choose: { kind: "constant", value: true },
            chooseCount: { kind: "constant", value: { min: 0, max: 1 } },
            choiceId: { kind: "constant", value: "wild-claw.pick-card" },
            linkedKey: { kind: "constant", value: "looked" },
            pickedKey: { kind: "constant", value: "lookedCards" },
            choosePicksKey: { kind: "constant", value: "selectedCard" }
          },
          picks: [
            {
              id: "wild-claw.top-five",
              // 牌库顶顺序由上游按 zoneSlice 语义提供（契约 3.6）；占位标记运行时供给方，
              // 静态 IR 不写运行时引用。
              options: ["runtime:main-deck-top-five"],
              // 432.1.c：牌库不足 5 张时尽可能查看。
              min: 0,
              max: 5,
              selection: "up-to",
              // 「a unit or gear」的类型限制：effect.inspect 的 choose 不读取 PickSpec.filter，
              // 该键是描述性记录（见 judgeReason 第 3 条），无消费方。
              filter: { type: ["unit", "gear"], zone: "deck", owner: "self" }
            }
          ]
        },
        {
          // "You may banish a unit or gear from among them and play it"：契约 3.9 用一个
          // choice.optional 把 banish + play 两条被选指令包进 body。
          id: "wild-claw.may-banish-and-play",
          op: "choice.optional",
          args: {
            prompt: {
              kind: "constant",
              value: "Banish a unit or gear from among them and play it?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "wild-claw.banish-chosen-card",
                  op: "effect.banish",
                  args: {
                    objects: { kind: "constant", value: { linked: "selectedCard" } },
                    amount: { kind: "constant", value: 1 },
                    linkKey: { kind: "constant", value: "banished" }
                  }
                },
                {
                  // "then play it, reducing its Energy cost by [5]"（420.3 / 356.1.c / 356.6）：
                  // 新引用从 banish 收据读（124），cost 记录所需的减费改写（无生产者，见 judgeReason）。
                  id: "wild-claw.play-it",
                  op: "effect.play",
                  linkedTo: "wild-claw.banish-chosen-card",
                  args: {
                    object: {
                      kind: "linked-value",
                      instructionId: "wild-claw.banish-chosen-card",
                      key: "banishedObject"
                    },
                    cost: {
                      kind: "constant",
                      value: {
                        kind: "cost.modify",
                        base: "printed",
                        discount: { resource: "energy", amount: 5, minimum: 0 },
                        finalized: false
                      }
                    }
                  }
                }
              ]
            }
          }
        },
        {
          // "Recycle the rest."（417.1.a / 417.4）：同一个已看牌列表；已放逐并打出的那张旧引用失效，
          // 因此实际回收的就是其余牌。
          id: "wild-claw.recycle-rest",
          op: "effect.recycle",
          args: {
            objects: {
              kind: "linked-value",
              instructionId: "wild-claw.look-top-five",
              key: "lookedCards"
            }
          }
        },
        {
          // "Then you may do this: Empower it."：第二个可选指令（契约 3.9）。"it" 指刚打出、现在在
          // Board 上的永久物；该引用没有生产者（见 judgeReason 第 2 条），此处以描述性 { linked }
          // 选择器记录意图——不改成 source/target，也不手写替代结算。
          id: "wild-claw.may-empower",
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Empower it?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "wild-claw.empower-it",
                  op: "effect.empower",
                  args: {
                    objects: {
                      kind: "constant",
                      value: { linked: "wild-claw.play-it" }
                    }
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
    "Look at the top 5 cards of your Main Deck. You may banish a unit or gear " +
    "from among them and play it, reducing its Energy cost by :rb_energy_5:. " +
    "Recycle the rest. Then you may do this: Empower it. (It becomes Empowered if " +
    "it's not already.)"
} satisfies CardProgram;

export default wildClaw;
