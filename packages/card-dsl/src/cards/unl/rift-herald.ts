import type { Ability, CardProgram, Instruction } from "../../ir/index.js";

/**
 * Rift Herald (unl-179-219) — Unit，8 能量 + 1 Order Power、Might 7，标签 The Void。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，unl-179-219，逐字）：
 *   When I move to a battlefield, look at the top 3 cards of your Main Deck. You
 *   may reveal a unit from among them and draw it. Recycle the rest.
 *   [Deathknell][>] Play a unit from your hand to your base, ignoring its
 *   Energy cost. (When I die, get the effect. You must still pay its Power cost.)
 *
 * 规则依据（CR v1.5）：
 * - 421.1 / 449.1 / 449.2：Move 由起点与终点定义；"When I move to a battlefield" 是移动触发，
 *   封闭时点表用 object-moved，终点是 battlefield（449.2 的目的地）。458 的 Recall 不算 Move。
 * - 437.1 / 437.3.a / 437.4："look at the top 3 cards" 是按牌库顺序的私下查看（Predict 家族
 *   的多张形式）；契约 3.6 规定取牌库顶必须用 zoneSlice（query 不保证区域顺序），查看由
 *   effect.inspect 承担（scope "top" 需要上游按区域顺序提供有序 picks）。437.4.a：牌库不足时
 *   尽可能看，不 Burn Out。
 * - 383.3.a.3 / 契约 3.9："You may reveal a unit from among them and draw it" 的"可以"包住
 *   被选指令（choice.optional 的 body），拒绝只是该指令 negated(skipped)，其后指令照常结算。
 * - 425.1 / 425.2.a："reveal a unit from among them" 把所选牌公开；"draw it" 按 414.1 把该张牌
 *   加入手牌（不是 draw GameAction 的抽牌），走 effect.zone 的 to "hand"（同 sfd/apprentice-smith）。
 * - 417.1 / 417.1.a / 417.6："Recycle the rest" 把未被取走的其余牌放回其拥有者主牌库底。
 * - 808.1 / 808.1.c：Deathknell 功能上等于 "When I die, [Effect]."；[Effect] 是
 *   "Play a unit from your hand to your base, ignoring its Energy cost."。
 * - 420.3 / 420.3.b.1：游戏效果指示的 Play 是 Limited Action，"ignoring its Energy cost"
 *   按 356.1.b.2 把该牌 base Energy 置 0、Power 仍付（原文括注）。355.7 / 355.10.a 例：
 *   "play a unit from your hand" 不指定目标（手牌是私有区域）→ 非目标选择（picks）。
 * - 括注 "(When I die, get the effect. You must still pay its Power cost.)" 是 808.1.c 与
 *   356.1.b.2 的提醒文本，不另写指令。
 *
 * status 判定（README 第 2 节，2026-10-17 逐条对源码复核）：judge-required —— 三处缺口，
 * 均不近似实现：
 * 1. "reveal a unit from among them" 的成员筛选仍缺可求值形态：需要"从已查看的 3 张里选 1 张
 *    单位"，而 effect.reveal 的 pick 只按已提供的引用集合读取（effect.reveal 文件头 425.4.a：
 *    展示后继续移动由后续指令处理），PickSpec.filter 对 linked 来源没有消费方，
 *    ObjectFilter 的 type 匹配只是同一对象上的判定，无法在这一步把"已查看集合"再按 unit 收窄。
 *    （原本一并记录的 chain/interpreter-adapter.ts LITERAL_FIELDS 未解码 effect.reveal.pick
 *    已修复：该字段现在会解包成字面量 id。）
 * 2. "[Deathknell]" 的 KeywordDef 展开仍引用未注册的 trigger.leave 原语
 *    （effects/instructions/registry.generated.ts 无该 op）；808.1.d.1–d.3 的触发收集、
 *    死亡被替代移出链与最后已知信息仍需该 op 接入事件/链管线。
 * 3. "Play a unit from your hand … ignoring its Energy cost" 需要为所选牌生成 base Energy 为 0、
 *    Power 保留的 finalized 费用计划：cost.printed/cost.pay/cost.modify 原语本体已合入，
 *    但没有生产方为“打出所选牌”生成这种计划（cost.modify 只读 ctx.source 或显式 printed，
 *    没有 linked 对象的印刷费投影；effect.play 只接受调用方已 finalize 的计划），
 *    卡牌程序不得自行推导打印费用（同 soulgorger 的判定）。
 * "look at the top 3 cards" 的有序来源已随 RIFT-358 合入：本卡的 PickSpec 声明显式有序来源，
 * chain Finalize 用 ctx.zoneSlice 锁定真实牌库顶并保序，golden 真实执行该锁定路径。
 * 程序保留 "look → optional(reveal + 取到手上) → recycle 其余" 的顺序与 effect.play 的调用形状。
 *
 * 依赖：选择集合成员谓词（reveal 的 unit 收窄）、trigger.leave 原语、cost 计划生产方。
 */

/**
 * "look at the top 3 cards of your Main Deck" 的有序 picks。本卡的 PickSpec 用
 * 契约 3.6 / RIFT-358 的显式有序来源（options: []、ordered: true、selection: "all"、
 * zoneSlice）声明"牌库顶 3 张"，Finalize 用 ctx.zoneSlice 锁定真实区域顺序。
 */
const TOP_THREE_LINK = "rift-herald.top-three";

const REVEAL_AND_DRAW_CHOICE = "rift-herald.may-reveal-and-draw";

const body: Instruction[] = [
  {
    // effect.inspect 需要显式的查看者；"your Main Deck" 的 you = 能力控制者（190.6.d）。
    // 先用 condition.value 把 source 的 controller 绑定成链接值，供查看指令读取
    // （同 unl/diana-lunari 的 bind-controller 写法）。
    id: "rift-herald.bind-controller",
    op: "condition.value",
    args: {
      value: { kind: "object-property", object: "source", property: "controller" },
      key: { kind: "constant", value: "controller" }
    }
  },
  {
    // 437.1 / 437.3.a 的多张查看 + 契约 3.6 的有序来源（缺口见 judgeReason 第 1 点）。
    id: "rift-herald.look-top-three",
    op: "effect.inspect",
    linkedTo: "rift-herald.bind-controller",
    args: {
      player: {
        kind: "linked-value",
        instructionId: "rift-herald.bind-controller",
        key: "controller"
      },
      zone: { kind: "constant", value: "deck" },
      scope: { kind: "constant", value: "top" },
      amount: { kind: "constant", value: 3 },
      picksSpecId: { kind: "constant", value: TOP_THREE_LINK },
      // 437.4/437.4.a：不足 3 张时尽可能看，不因牌库不足失败（不设强制选择）。
      choose: { kind: "constant", value: false },
      pickedKey: { kind: "constant", value: "rift-herald.looked" },
      linkedKey: { kind: "constant", value: "rift-herald.looked-count" }
    },
    picks: [
      {
        id: TOP_THREE_LINK,
        // 契约 3.6 / RIFT-358：显式有序来源；query 顺序绝不被采用。
        options: [],
        ordered: true,
        selection: "all",
        zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 3 } }
      }
    ]
  },
  {
    // 383.3.a.3 / 契约 3.9："You may reveal …" 把被选指令包进 body。
    id: REVEAL_AND_DRAW_CHOICE,
    op: "choice.optional",
    linkedTo: "rift-herald.look-top-three",
    args: {
      prompt: { kind: "constant", value: "Reveal a unit from among them and draw it?" },
      body: {
        kind: "constant",
        value: [
          {
            // 425.1/425.2.a：公开所选的单位牌（成员筛选缺口见 judgeReason 第 2 点）。
            id: "rift-herald.reveal-unit",
            op: "effect.reveal",
            args: { pick: { kind: "constant", value: "rift-herald.revealed-unit" } },
            picks: [
              {
                id: "rift-herald.revealed-unit",
                options: [
                  {
                    kind: "linked-value",
                    instructionId: "rift-herald.look-top-three",
                    key: "rift-herald.looked"
                  }
                ],
                min: 1,
                max: 1,
                selection: "one",
                // "a unit from among them" 的成员类型限制（缺口见 judgeReason 第 2 点）。
                filter: { type: "unit" }
              }
            ]
          },
          {
            // 414.1："draw it" 把刚展示的那张加入手牌（非抽牌动作），走 effect.zone。
            id: "rift-herald.draw-revealed",
            op: "effect.zone",
            linkedTo: "rift-herald.reveal-unit",
            args: {
              pick: { kind: "constant", value: "rift-herald.revealed-unit" },
              to: { kind: "constant", value: "hand" },
              amount: { kind: "constant", value: 1 }
            }
          }
        ]
      }
    }
  },
  {
    // 417.1/417.1.a："Recycle the rest" 把查看集合中未被取走的牌放回其拥有者主牌库底。
    // 被取走（已进手牌）的引用会因换区失效而被原语丢弃（359.3.e.6 的旧引用语义）。
    id: "rift-herald.recycle-rest",
    op: "effect.recycle",
    linkedTo: "rift-herald.look-top-three",
    args: {
      objects: {
        kind: "linked-value",
        instructionId: "rift-herald.look-top-three",
        key: "rift-herald.looked"
      }
    }
  }
];

const deathknellBody: Instruction[] = [
  {
    // 420.3 / 420.3.b.1：游戏效果指示的 Play（非目标选择，355.7/355.10.a 的手牌例）。
    id: "rift-herald.play-unit-from-hand",
    op: "effect.play",
    args: {
      pick: { kind: "constant", value: "rift-herald.unit-in-hand" },
      // 356.1.b.2：只忽略 Energy；Power 仍须支付（原文括注）。
      // 真实计划必须由费用系统按被选牌的印刷费用生成（缺口见 judgeReason 第 4 点）；
      // 这里不写死被忽略牌的印刷费用，也不把 null 改成 0。
      cost: {
        kind: "constant",
        value: { finalized: true, energy: 0, power: [], ignoreEnergyOfSelectedCard: true }
      },
      // "to your base"：打出位置 = 能力控制者的 Base（355.2.b / 381）。
      location: { kind: "constant", value: { type: "base", player: "controller" } },
      linkKey: { kind: "constant", value: "rift-herald.played" }
    },
    picks: [
      {
        id: "rift-herald.unit-in-hand",
        options: ["unit-card-in-controller-hand"],
        min: 1,
        max: 1,
        selection: "one",
        filter: { zone: "hand", owner: "controller", type: "unit" }
      }
    ]
  }
];

const abilities: Ability[] = [
  {
    kind: "triggered",
    // "When I move to a battlefield"：终点是战场（449.2）；Recall 不触发（458）。
    trigger: {
      at: "object-moved",
      filter: { event: "object-moved", filter: { source: "self" }, toZone: "battlefield" }
    },
    optional: false,
    body
  },
  // 808.1：Deathknell 只声明，展开属关键词注册表（契约 3.7）。
  { kind: "keyword", keyword: "deathknell" },
  {
    // 808.1.c："When I die, [Effect]" —— [Effect] 本体挂在 object-killed 触发上
    // （同 ruined-rex / kogmaw-caustic 的写法）。
    kind: "triggered",
    trigger: { at: "object-killed", filter: { event: "object-killed", filter: { source: "self" } } },
    optional: false,
    body: deathknellBody
  }
];

export default {
  canonicalCardId:
    "card.hash-3a0b70431fa51262d1b6a8b6d9998f8531df9a50ab7dbe01cf460fe93f9ffff3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处当前缺口（2026-10-17 对源码复核，均不近似实现）：(1)「reveal a unit from among them」缺少" +
    "「已查看集合按 unit 收窄」的成员筛选：effect.reveal 只按 ctx.picks 读取已提供的引用集合" +
    "（425.4.a：展示后继续移动由后续指令处理），PickSpec.filter 对 linked 来源没有消费方，" +
    "无法在这一步把 looked-at 3 张按 unit 过滤；chain/interpreter-adapter.ts 的 LITERAL_FIELDS " +
    "已解码 effect.reveal.pick，该段不再是缺口。(2) [Deathknell]（808.1）的 KeywordDef 展开仍引用" +
    "未注册的 trigger.leave 原语（effects/instructions/registry.generated.ts 无该 op），" +
    "808.1.d.1–d.3 的触发收集、死亡被替代移出链与最后已知信息仍需该 op 接入事件/链管线。" +
    "(3)「Play a unit from your hand … ignoring its Energy cost」需要为所选牌生成 base Energy=0、" +
    "Power 保留的 finalized 费用计划（356.1.b.2）；cost.printed/cost.pay/cost.modify 原语本体已合入，" +
    "但没有生产方为“打出所选牌”生成这种计划（cost.modify 无 linked 对象印刷费投影，" +
    "effect.play 只接受调用方已 finalize 的计划），卡牌程序不得自行推导被选牌的印刷费用，" +
    "也不把 null 写成 0（同 soulgorger 的判定）。「look at the top 3 cards」的有序来源已由合并后的 " +
    "zoneSlice 有序 pick 生命周期承担：" +
    "本卡的 PickSpec 是显式有序来源（options: []、ordered: true、selection: \"all\"、zoneSlice），" +
    "Finalize 用 ctx.zoneSlice 锁定真实牌库顶三张并保序，golden 真实执行该锁定路径以及 " +
    "look → optional(reveal+取到手牌) → recycle 其余的顺序。",
  abilities,
  sourceText:
    "When I move to a battlefield, look at the top 3 cards of your Main Deck. You may reveal a unit from among them and draw it. Recycle the rest.\n" +
    "[Deathknell][>] Play a unit from your hand to your base, ignoring its Energy cost. (When I die, get the effect. You must still pay its Power cost.)"
} satisfies CardProgram;
