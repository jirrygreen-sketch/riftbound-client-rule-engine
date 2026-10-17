import type { CardProgram } from "../../ir/index.js";

/**
 * Double Trouble（unl-032-219）— Spell，2 能量，无印刷力量，领域 Calm。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-032-219，逐字）：
 *   "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this
 *    spell's effect.)\n" +
 *   "Look at the top 3 cards of your Main Deck. You may reveal a unit from
 *    among them and draw it. Recycle the rest."
 *
 * 规则依据（CR v1.5）：
 * - [Repeat]（820.1/820.1.c.1）：印刷费用 2 能量由 keyword: "repeat" 声明；KeywordAbility
 *   当前只能承载 keyword/value，不能把印刷费用参数挂在关键词节点上。打出本体的 2 能量
 *   基础费用由 play 的 cost.printed 声明。支付后 820.1.d.1 让本牌的效果在结算时额外执行一次，
 *   820.2/820.2.a 要求重新做选择；这部分由 Repeat 关键词展开与结算接线承担
 *   （effects/keywords/Repeat.ts 只声明 repeat.cost 静态效果）。卡内不手写重复执行。
 * - 「Look at the top 3 cards of your Main Deck」是私下查看（128.3-128.4 look），必须按
 *   牌库真实顺序取（108.4.e；契约 3.6 的 zoneSlice），已合入的 effect.inspect 用
 *   scope "top" + 上游有序 picksSpecId 表达（与已合入 ogn/stacked-deck 同形）。
 * - 「You may reveal a unit from among them and draw it」：契约 3.9 的 choice.optional
 *   把被选指令包进 body；reveal 是 425.1 的公开展示（425.1.a.2：牌留在原区域），
 *   "a unit from among them" 是非目标选择（355.10.a：牌库不是公开区域）→ effect.reveal
 *   的 pick，filter 记 unit 限制。"draw it" 按 414.1.a 的指定来源语义把该张牌加入手牌
 *   （不是从牌库顶抽牌），用 effect.zone 的 to: "hand"（同 sfd/apprentice-smith 的
 *   "draw it" 处理）。
 * - 「Recycle the rest」是独立语句（417.1.a/417.4/417.6）：回收本次查看的集合，已离区
 *   （进入手牌）的引用按 124 失效并被 effect.recycle 丢弃，剩下的正是其余牌。
 *
 * status = judge-required（README 第 2 节，2026-10-17 逐条对源码复核）：
 * 1. 「按牌库顶顺序取前 3 张」已由 RIFT-358 合入的有序 pick 生命周期承担：本卡把
 *    PickSpec 写成显式有序来源（options: []、ordered: true、selection: "all"、
 *    zoneSlice { zone: "deck", from: "top", count: 3 }），chain Finalize 用
 *    ctx.zoneSlice 锁定真实牌库顶三张并保序（chain/picks/plan.ts 是唯一顺序权威），
 *    Resolve 期 effect.inspect 读该锁定集合。
 * 2. [Repeat] 的印刷费用参数、追加费用收取与「已付费实例数 → 额外执行一次」接线仍未合入：
 *    programs/play.ts 的 translateCost 对 kind "additional-cost" 直接 judgeRequired
 *    （"Additional costs are not bound for …"），effects/keywords/Repeat.ts 展开的静态
 *    repeat.cost 在 programs/statics.ts layerFor 抛 "no layer mapping"（实测），
 *    契约 3.1 的 KeywordAbility 也没有承载 :rb_energy_2: 的字段，结算端没有把已付费
 *    实例数接到解释器内建 repeat 节点的读取方。
 * golden 在真实 ChainEngine 上执行 Finalize 锁定 + Resolve 全链（inspect → optional(reveal
 * → zone to hand) → recycle）；Repeat 部分写 test.todo。
 */
const doubleTrouble = {
  canonicalCardId: "card.hash-daadc507f6831def277e2708c2368b3d4b9d91466770b9edea36a47ecbb044c7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "唯一剩余缺口是「[Repeat] :rb_energy_2:」的可选追加费用与 paid-instance 结算接线（CR 820.1.c.1/820.1.d.1/820.2）：" +
    "programs/play.ts 的 translateCost 对 kind \"additional-cost\" 直接 judgeRequired（\"Additional costs are not bound for …\"），" +
    "effects/keywords/Repeat.ts 展开的静态 repeat.cost 在 programs/statics.ts 的 layerFor 抛 ProgramBindingError \"no layer mapping\"（实测），" +
    "契约 3.1 的 KeywordAbility 也没有承载印刷费用参数的字段，结算端没有把已付费实例数接到解释器内建 repeat 节点，" +
    "因此卡内不手写重复执行。「Look at the top 3 cards of your Main Deck」已按 RIFT-358 迁移到合并后的有序 pick 生命周期：" +
    "PickSpec 是显式有序来源（options: []、ordered: true、selection: \"all\"、zoneSlice { zone: \"deck\", from: \"top\", count: 3 }），" +
    "Finalize 用 ctx.zoneSlice 锁定真实牌库顶三张并保序，Resolve 期 inspect→可选 reveal→draw→recycle 在真实 ChainEngine 上执行。" +
    "依赖：Repeat 费用收取与 paid-instance 结算接线。",
  abilities: [
    { kind: "keyword", keyword: "repeat" },
    {
      kind: "play",
      // 印刷基础费用 2 能量由费用管线从 catalog 绑定（356.1.c）；KeywordAbility
      // 当前没有字段承载 [Repeat] 的 :rb_energy_2: 参数，因此不把追加费用伪装成 play cost。
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 }
      },
      body: [
        {
          id: "double-trouble.bind-controller",
          // 「your Main Deck」= 施法者的主牌库（190.6.d 的隐含 “you”）。
          // effect.inspect 的 argsSchema 只接受无选择器的 Expr（object-property 的
          // object 仍被校验为运行时 ObjectRef），故按已合入 ogn/stacked-deck 的写法先
          // 用 condition.value 把控制者绑定成链接值，再以 linked-value 读回。
          op: "condition.value",
          args: {
            value: { kind: "object-property", object: "source", property: "controller" },
            key: { kind: "constant", value: "controller" }
          }
        },
        {
          id: "double-trouble.look",
          op: "effect.inspect",
          linkedTo: "double-trouble.bind-controller",
          args: {
            player: {
              kind: "linked-value",
              instructionId: "double-trouble.bind-controller",
              key: "controller"
            },
            zone: { kind: "constant", value: "deck" },
            scope: { kind: "constant", value: "top" },
            amount: { kind: "constant", value: 3 },
            picksSpecId: { kind: "constant", value: "double-trouble.viewed-cards" },
            linkedKey: { kind: "constant", value: "viewedCount" },
            pickedKey: { kind: "constant", value: "viewed" }
          },
          picks: [
            {
              id: "double-trouble.viewed-cards",
              // 契约 3.6 / RIFT-358：显式有序来源 = options: []、ordered: true、
              // selection: "all"，Finalize 按 zoneSlice 锁定真实牌库顶三张并保序；
              // query 顺序绝不被采用（effect.inspect 缺有序来源时按 impossible 阻断）。
              options: [],
              ordered: true,
              selection: "all",
              zoneSlice: {
                zone: "deck",
                from: "top",
                count: { kind: "constant", value: 3 }
              }
            }
          ]
        },
        {
          id: "double-trouble.may-reveal",
          // 「You may reveal …」：契约 3.9 要求把被选指令包进 choice.optional 的 body，
          // 而不是先放一个 choice 再让后续指令 linkedTo 它。
          op: "choice.optional",
          linkedTo: "double-trouble.look",
          args: {
            prompt: {
              kind: "constant",
              value: "Reveal a unit among the looked-at cards and draw it?"
            },
            body: {
              kind: "constant",
              value: [
                {
                  id: "double-trouble.reveal-unit",
                  // 「reveal a unit from among them」：非目标选择（355.10.a 的牌库
                  // 非公开区域）+ 425.1 公开展示；filter 记录印刷的 unit 限制。
                  op: "effect.reveal",
                  linkedTo: "double-trouble.look",
                  args: {
                    pick: { kind: "constant", value: "double-trouble.revealed-unit" }
                  },
                  picks: [
                    {
                      id: "double-trouble.revealed-unit",
                      options: [
                        {
                          kind: "linked-value",
                          instructionId: "double-trouble.look",
                          key: "viewed"
                        }
                      ],
                      filter: { type: "unit" },
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                },
                {
                  id: "double-trouble.draw-it",
                  // 「and draw it」= 414.1.a 的指定来源：把刚展示的那张牌加入手牌，
                  // 不是从牌库顶抽牌（故用 effect.zone 而不是 effect.draw）。
                  op: "effect.zone",
                  linkedTo: "double-trouble.reveal-unit",
                  args: {
                    pick: { kind: "constant", value: "double-trouble.drawn-card" },
                    to: { kind: "constant", value: "hand" },
                    amount: { kind: "constant", value: 1 }
                  },
                  picks: [
                    {
                      id: "double-trouble.drawn-card",
                      options: [
                        {
                          kind: "linked-value",
                          instructionId: "double-trouble.reveal-unit",
                          key: "revealed"
                        }
                      ],
                      min: 1,
                      max: 1,
                      selection: "one"
                    }
                  ]
                }
              ]
            }
          }
        },
        {
          id: "double-trouble.recycle-rest",
          // 「Recycle the rest.」是独立语句：回收本次查看的集合；已进入手牌的牌引用失效
          // （124）被丢弃，剩下两张回收到各自牌库底（417.1.a）。
          op: "effect.recycle",
          args: {
            objects: {
              kind: "linked-value",
              instructionId: "double-trouble.look",
              key: "viewed"
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
    "Look at the top 3 cards of your Main Deck. You may reveal a unit from among them and draw it. Recycle the rest."
} satisfies CardProgram;

export default doubleTrouble;
