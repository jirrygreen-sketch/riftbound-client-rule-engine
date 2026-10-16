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
 * - [Repeat]（820.1/820.1.c.1）：印刷费用 2 能量是打出时支付的追加费用，按契约 3.1
 *   声明在 play 的 CostSpec 上，并带显式的 pay/decline 选择（与已合入的
 *   sfd/frigid-touch 同一形状）。支付后 820.1.d.1 让本牌的效果在结算时额外执行一次，
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
 * status = judge-required（README 第 2 节），两处依赖未合入，均不近似实现：
 * 1. 「按牌库顶顺序取前 3 张」的生产选择生命周期缺失：effect.inspect 的 top scope 必须由
 *    上游提供有序 picksSpecId（其文件头明确 query 不保证区域顺序、缺有序来源时
 *    negated/impossible）；已合入的链 Finalize 只锁定 instruction.targets 的 TargetSpec
 *    （chain/engine.ts assertFinalizationSurface），没有有序区域 pick 的锁定路径。
 * 2. [Repeat] 的追加费用收取与「已付费实例数 → 额外执行一次」接线未合入：Repeat.ts
 *    只声明 repeat.cost 静态效果，消费方（RIFT-89/91 的费用计划）与结算端计数读取缺失。
 * golden 借参考内核提供有序 picks 与选择答案，真实执行 inspect → optional(reveal →
 * zone to hand) → recycle 全链；Repeat 部分写 test.todo。
 */
const doubleTrouble = {
  canonicalCardId: "card.hash-daadc507f6831def277e2708c2368b3d4b9d91466770b9edea36a47ecbb044c7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入：(1)「Look at the top 3 cards of your Main Deck」需要按牌库真实顺序的有序 picks——" +
    "effect.inspect 的 top scope 必须由上游提供有序 picksSpecId（其文件头明确 query 不保证区域内顺序、缺有序来源时 negated/impossible），" +
    "已合入的链 Finalize 只锁定 instruction.targets 的 TargetSpec，没有有序区域 pick 的锁定路径（同 ogn/stacked-deck 的缺口）。(2) " +
    "[Repeat] :rb_energy_2: 的追加费用收取与「已付费实例数 → 结算时额外执行一次」（CR 820.1.c.1/820.1.d.1/820.2）尚未接线：" +
    "effects/keywords/Repeat.ts 只声明 repeat.cost 静态效果，费用计划消费方与结算端计数读取属 RIFT-89/91 批次。" +
    "查看→可选 reveal→draw→recycle 四段只用已合入原语，golden 借参考内核提供有序 picks 与选择答案真实执行；不近似实现。" +
    "依赖：有序区域 picks / Finalize 生命周期、RIFT-89/91（Repeat 费用与结算接线）。",
  abilities: [
    {
      kind: "play",
      // 印刷基础费用 2 能量由费用管线从 catalog 绑定（356.1.c）；这里显式声明的是
      // [Repeat] 的追加费用 2 能量（820.1.c.1），与已合入 sfd/danger-zone 的写法一致。
      // 该追加费用的收取与「已付费实例数 → 额外执行一次」的计数读取尚未接线
      // （Repeat.ts 目前只声明 repeat.cost 静态效果），见 judgeReason 第 2 点。
      cost: {
        kind: "additional-cost",
        keyword: "repeat",
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
              // 牌库顶前 3 张（含顺序），由上游 zoneSlice 顺序提供；缺有序来源时
              // effect.inspect 明确阻断而不是用集合查询近似。
              options: ["dynamic:top-3-cards-of-your-main-deck-in-zone-order"],
              min: 3,
              max: 3,
              selection: "all",
              filter: { owner: "self", zone: "deck" }
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
