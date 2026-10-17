import type { CardProgram } from "../../ir/index.js";

/**
 * Lightning Rush (ven-156-166) — Spell, 1 Energy, 印刷 Power 为 null（无印刷 Power 费用），
 * tags Kennen/Signature. Might null（法术没有印刷 Might）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-156-166，逐字）:
 *   "Look at the top 3 cards of your Main Deck. You may choose a card from among
 *    them and draw it. Put the rest into your trash.
 *    [Flow] :rb_energy_2::rb_rune_rainbow: (You may play this from your trash for
 *    its Flow cost. Then banish it.)"
 *
 * 规则依据（CR v1.5）:
 * - "Look at the top 3 cards of your Main Deck"：look 只向该玩家披露（128.3–128.4；主牌库顺序是
 *   秘密信息 108.4.e），由已合入的 effect.inspect 的 top 作用域表达；非零 top 查看必须读区域真实
 *   顺序（契约 3.6 的 zoneSlice），原语明确要求上游提供有序 picksSpecId，缺有序来源时 negated，
 *   不得退回无序 query 近似。
 * - "You may choose a card from among them and draw it"：结算时的可选从句（决策点是结算，不是
 *   Finalize 的首段 may），按契约 3.9 用 choice.optional 把“选牌并抽入手牌”整段包进 body。
 *   被选中的牌在主牌库（非公开区域）→ 355.10.a 不是目标，走非目标 pick（355.7 的 pick/target 区分）。
 *   414.1 / 414.1.a 的 “draw it” 指定被选牌；effect.zone 目前只证明移入手牌，
 *   尚缺对应 Draw 动作/事件，effect.draw 又只支持数量，故整卡保持 judge-required。
 * - "Put the rest into your trash"：由上一段实际移走的牌以外的同组牌 → effect.zone（to: "trash"）。
 *   「the rest」不是玩家选择：结算时把看过的整组牌作为候选交给原语，已经离开牌库进入手牌的那张
 *   引用已失效（124：换区产生新对象身份），被 effect.zone 按 359.3.e 丢掉，剩下的正是“其余”。
 *   因此这条指令不写 amount（effect.zone 缺省移动全部仍合法的所选对象）：选了牌时剩下 2 张、
 *   拒绝抽牌时三张都留下，两种情况都由同一形状覆盖，不用把张数写死。
 * - [Flow]（829）是费用改写关键词（829.1.c 的 "Flow [Cost]"）：印刷费用为 2 Energy + 1 rainbow
 *   Power。Flow KeywordDef 已合入，本卡只声明关键词；Flow 的消费与离链替代仍未接线。
 *
 * status = judge-required。已合入依赖与剩余生产接线已重新核对；
 * 当前真实缺口以 judgeReason 为准，子效果执行不证明整卡可执行。
 */
const lightningRush = {
  canonicalCardId: "card.hash-caa60c112cdc9dccc741c15d4bb6d88be761ea9eff1495e0945ebb1a86bc5d74",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺：(1) KeywordAbility / programs/keywords.ts 未传 params.cost，无法绑定 Flow 的 2 Energy + 1 任意域 Power（829.1.c）；" +
    "(2) programs/play.ts 未消费 flow.cost 以选择备选费用、许可从 trash 打出，也未关联实付实例的离链放逐及自身指令离链例外（829.1.b.1）；" +
    "(3) 可选分支里的单牌非目标 pick 仍只有描述性 options，尚未接入 Resolve 选择；" +
    "(4) effect.zone 只移动到手牌，effect.draw 又只支持数量，缺 414.1 / 414.1.a 的指定牌 Draw 动作/事件；" +
    "zoneSlice → Finalize → picksSpecId 的查看与 linked 余牌已有执行证据，但不能补齐上述缺口。",
  abilities: [
    // 829.1 / 829.1.c：印刷的 [Flow] 替代费用关键词，只声明不重写展开。
    { kind: "keyword", keyword: "flow" },
    {
      kind: "play",
      body: [
        {
          // "your Main Deck" = 能力控制者（190.6.d 的隐含 you）；effect.inspect 的 player 需要一个
          // 可求值的 Expr，卡面数据先把控制者绑定为链接值（同 stacked-deck 的写法），解释器在
          // 结算时经 object-property 读 source 的 controller。
          id: "lightning-rush.bind-controller",
          op: "condition.value",
          args: {
            value: { kind: "object-property", object: "source", property: "controller" },
            key: { kind: "constant", value: "controller" }
          }
        },
        {
          // "Look at the top 3 cards of your Main Deck"：私下查看（128.3–128.4），有序来源见 judgeReason。
          id: "lightning-rush.look-top-three",
          op: "effect.inspect",
          linkedTo: "lightning-rush.bind-controller",
          args: {
            player: {
              kind: "linked-value",
              instructionId: "lightning-rush.bind-controller",
              key: "controller"
            },
            zone: { kind: "constant", value: "deck" },
            scope: { kind: "constant", value: "top" },
            amount: { kind: "constant", value: 3 },
            // 牌库顶前三张（含顺序）由上游按 zoneSlice 顺序提供（契约 3.6）。
            picksSpecId: { kind: "constant", value: "lightning-rush.viewed" },
            linkedKey: { kind: "constant", value: "viewedCount" },
            pickedKey: { kind: "constant", value: "viewed" }
          },
          picks: [
            {
              id: "lightning-rush.viewed",
              options: [],
              ordered: true,
              selection: "all",
              zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 3 } }
            }
          ]
        },
        {
          // "You may choose a card from among them and draw it"（结算时的可选从句，契约 3.9：
          // 被选指令包进 body，不写成 choice + linkedTo）。
          id: "lightning-rush.may-draw-chosen-card",
          op: "choice.optional",
          linkedTo: "lightning-rush.look-top-three",
          args: {
            prompt: { kind: "constant", value: "Choose a card from among them and draw it?" },
            body: {
              kind: "constant",
              value: [
                {
                  // 355.10.a: a private non-target pick. This supported zone
                  // movement still lacks the chosen-card Draw event (414.1).
                  id: "lightning-rush.draw-chosen-card",
                  op: "effect.zone",
                  args: {
                    pick: { kind: "constant", value: "lightning-rush.chosen-card" },
                    to: { kind: "constant", value: "hand" },
                    amount: { kind: "constant", value: 1 }
                  },
                  picks: [
                    {
                      id: "lightning-rush.chosen-card",
                      options: [
                        {
                          kind: "linked-value",
                          instructionId: "lightning-rush.look-top-three",
                          key: "viewed"
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
          // "Put the rest into your trash"：候选是看过的整组牌；被移入手牌的那张引用已失效（124），
          // 由原语按 359.3.e 丢弃，剩下的正是“其余”。不写 amount：缺省移动全部仍合法的候选，
          // 因此“抽走 1 张后剩 2 张”和“拒绝抽牌时 3 张全留”都由同一形状覆盖（不写死张数）。
          id: "lightning-rush.put-rest-into-trash",
          op: "effect.zone",
          linkedTo: "lightning-rush.look-top-three",
          args: {
            pick: { kind: "constant", value: "lightning-rush.rest" },
            to: { kind: "constant", value: "trash" }
          },
          picks: [
            {
              id: "lightning-rush.rest",
              options: [],
              ordered: true,
              selection: "all",
              linked: {
                kind: "linked-value",
                instructionId: "lightning-rush.look-top-three",
                key: "viewed"
              }
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "Look at the top 3 cards of your Main Deck. You may choose a card from among them and draw it. " +
    "Put the rest into your trash.\n" +
    "[Flow] :rb_energy_2::rb_rune_rainbow: (You may play this from your trash for its Flow cost. Then banish it.)"
} satisfies CardProgram;

export default lightningRush;
