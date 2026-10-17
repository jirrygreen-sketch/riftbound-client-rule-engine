import type { CardProgram } from "../../ir/index.js";

/**
 * Hand of Noxus (ogn-253-298) — Legend, Fury/Order, Darius.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-253-298，逐字）：
 *   :rb_exhaust:: [Reaction], [Legion] — [Add] :rb_energy_1:. (Abilities that
 *   add resources can't be reacted to. Get the effect if you've played a card
 *   this turn.)
 *
 * 规则依据（CR v1.5）：
 * - 404.1.a / 415.5：“:” 前的 :rb_exhaust: 是启动能力的费用（"Exhaust me"）；
 *   合并费用管线支持 { kind: "exhaust", object: "self" }。
 * - 813.1.d / 813.1.c：能力上的 [Reaction] 是 Closed State 启动许可，IR 用
 *   activated.timing = "reaction" 声明；430.3 另允许 Reaction Add 在支付费用时启动。
 * - 430.1 / 430.2.a：[Add] :rb_energy_1: 是 Add 动作，加 1 Energy；触发式/启动式 Add
 *   能力 Finalize 后立即结算、不传递 Priority/Focus（由链与费用管线负责）。
 * - 812.1 / 812.1.b.1 / 812.1.c：[Legion] 是依赖型关键词，功能等价于
 *   “若你本回合已 Finalize 过另一张牌，此牌获得 [Text]”；[Text] 是依赖能力
 *   （本卡的 [Add] 1）。排除本卡自身（812.1.c “与持有 Legion 的牌不同”）需要
 *   HistoryQuery 的 exclude 维度（契约 3.8 第 2 条），由关键词展开提供谓词。
 *
 * status = judge-required：
 * - [Legion] is declared as the keyword per the cards README section 5, like
 *   every other Legion card. Its merged expansion (effects/keywords/Legion.ts)
 *   publishes a condition.predicate static carrying the 812.1.c history
 *   payload (excluding the host canonical identity), but that payload still
 *   has no consumer; the closed Condition vocabulary has no history node and
 *   count expressions ignore their cards-finalized-this-turn subject. Because
 *   ActivatedAbility has no condition slot, the printed gate is additionally
 *   kept as a restriction so the pre-cost Legion check stays auditable; it is
 *   not treated as an executable comparison.
 * - The ordinary exhaust payment and resource primitive are merged, and the
 *   chain has the immediate Add path, but the activation binder does not
 *   classify this resource-adding ability for the 430.2.a/430.3 window.
 * - Legend Zone (107.4.a-d): the frozen ZoneId/ZoneDestination unions have no
 *   legend-zone, and the cost payer accepts only board/rune-zone exhaust hosts
 *   (415.4/415.5), so the printed Exhaust cost cannot cite the legend's real
 *   zone in production; golden execution uses a Board fixture as partial
 *   evidence only.
 */
const handOfNoxus = {
  canonicalCardId:
    "card.hash-c65f6bc670e670cfb9086db63e2e7e090e36f226d4eb71005c0460c57fe89b49",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Legion] 已按 cards README §5 声明为 keyword（展开已合入）：effects/keywords/Legion.ts 发布 condition.predicate 静态谓词并携带 " +
    "CR 812.1.c 的按 canonicalCardId 排除载荷，但该载荷仍没有消费方，CardProgram 的封闭 Condition 词汇没有 history 节点，" +
    "count 表达式也只查询当前对象、忽略 cards-finalized-this-turn 的 subject；ActivatedAbility 没有条件槽位，" +
    "translateRestriction 不能在支付启动费用前执行历史指令并读取结果（本卡的 value+condition 组合仍抛 “combines condition and value without an adapter”），" +
    "因此印刷闸门另以 restriction 保留可审查形状。还缺 describeActivate 按资源增加正文识别 kind: add 的桥接：" +
    "当前固定生成 activated，不能进入 CR 430.2.a 的即时 Add 结算与 430.3 的 Reaction-Add 支付窗口。" +
    "另缺 CR 107.4.a–d 的 Legend Zone：ZoneId/ZoneDestination 没有 legend-zone，费用支付只接受 board/rune-zone 的横置对象（415.4/415.5），" +
    "传奇无法在真实区域支付 :rb_exhaust:；golden 的 Board 装置只是部分证据。",
  abilities: [
    // 812.1/812.1.a/812.3：Legion 按 §5 声明为关键词，展开与依赖能力正文由引擎侧负责。
    { kind: "keyword", keyword: "legion" },
    {
      kind: "activated",
      timing: "reaction",
      cost: {
        kind: "activated",
        payments: [{ kind: "exhaust", object: "self" }]
      },
      restriction: {
        kind: "legion",
        value: { kind: "constant", value: "legion-gate" },
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "cards-finalized-this-turn",
            filter: { player: "controller", exclude: "self" }
          },
          operator: "gte",
          right: { kind: "constant", value: 1 }
        }
      },
      body: [
        {
          id: "hand-of-noxus.add-energy",
          op: "effect.resources",
          args: {
            energy: { kind: "constant", value: 1 }
          }
        }
      ]
    }
  ],
  sourceText:
    ":rb_exhaust:: [Reaction], [Legion] — [Add] :rb_energy_1:. (Abilities that add resources " +
    "can't be reacted to. Get the effect if you've played a card this turn.)"
} satisfies CardProgram;

export default handOfNoxus;
