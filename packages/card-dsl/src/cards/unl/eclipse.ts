import type { CardProgram } from "../../ir/index.js";

/**
 * Eclipse（unl-063-219）— Spell，3 能量，无印刷力量，领域 Mind。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-063-219，逐字）：
 *   "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
 *   "Give a unit -4 :rb_might: this turn.\n" +
 *   "[Predict]. (Look at the top card of your Main Deck. You may recycle it.)"
 *
 * 规则依据（CR v1.5）：
 * - [Reaction]（813）是许可类关键词，按契约 3.7 只声明。
 * - 「Give a unit -4 :rb_might: this turn」是临时 Might 修正：按 143.2.a，卡面的 “Might” 是
 *   算上图层修改后的有效值；143.2.c 规定 Might 即使被减到 0 以下也只按 0 被引用（“treated
 *   as 0, it is not 0”，143.2.c.1），到期由 317.2.c 的回合结束清理统一处理。effect.buff
 *   文件头明确临时 Might 归 continuous.might、不是 Buff 计数器（702/703 另一回事）。
 * - 「[Predict]」不是 805-832 关键词表里的关键词，而是 437 的 Predict 动作：437.1 是
 *   「看主牌库顶一张牌并选择是否回收」，437.2 是 Limited Action，437.3 的格式是
 *   "Predict X."，437.3.a 规定省略数值时 X = 1，437.4/437.4.a 规定牌库不足时尽可能多看且
 *   不触发 Burn Out。本体拆成两条已合入原语：effect.inspect（scope "top"、amount 1、
 *   0..1 张进入回收；牌库顶的有序范围由上游 picksSpecId 提供，契约 3.6 的 zoneSlice 语义）
 *   与 effect.recycle（417.1.b：回收进对应牌库底）。
 *
 * 结构说明：两条正文按印刷顺序各占一条指令、互不链接（两个独立句子，055 /
 * 359.3.e.11：Might 指令失败时 Predict 照常执行）；「your Main Deck」用 condition.value
 * 在结算时读出来源控制者，再以 linked-value 交给 effect.inspect（190.6.d 的隐含 “you”；
 * 与已合入 ogn/stacked-deck 同一写法，避免把玩家 id 硬编码进卡数据）。
 *
 * status = executable：临时 Might 修正已由 continuous.might 原语真实登记并由图层求值，
 * Predict 的牌库顶也通过已合入的 PickSpec.zoneSlice 在 Finalize 锁定真实区域顺序，
 * 再由 effect.inspect/effect.recycle 完成结算。
 */
const eclipse = {
  canonicalCardId: "card.hash-de24e677d5541604808bbe583f958d702c8e2067e5a554af3d856ceac17c6354",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    { kind: "keyword", keyword: "reaction" },
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 3 }
      },
      body: [
        {
          id: "eclipse.give-minus-4-might",
          // 临时 Might 修正：算术图层的 continuous.might（见 judgeReason）。
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: -4 },
            duration: { kind: "constant", value: "this-turn" },
            // The primitive resolves selector descriptors from `objects`; this
            // keeps the TargetSpec binding in the production chain context.
            objects: {
              kind: "constant",
              value: { kind: "target", id: "eclipse.chosen-unit" }
            }
          },
          targets: [
            {
              id: "eclipse.chosen-unit",
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "eclipse.bind-controller",
          // 「your Main Deck」= 施法者的主牌库（190.6.d）；effect.inspect 的 player 需要
          // 单个 PlayerId 表达式，先绑定再用 linked-value 读回（同 ogn/stacked-deck）。
          op: "condition.value",
          args: {
            value: { kind: "object-property", object: "source", property: "controller" },
            key: { kind: "constant", value: "controller" }
          }
        },
        {
          id: "eclipse.predict-look",
          // 437.1 / 437.3.a：看主牌库顶 1 张，并选择 0..1 张进入回收。牌库顶的有序范围
          // 由上游按 zoneSlice 语义提供（缺有序来源时 effect.inspect 明确阻断，
          // 不用无序 query 近似）。
          op: "effect.inspect",
          linkedTo: "eclipse.bind-controller",
          args: {
            player: {
              kind: "linked-value",
              instructionId: "eclipse.bind-controller",
              key: "controller"
            },
            zone: { kind: "constant", value: "deck" },
            scope: { kind: "constant", value: "top" },
            amount: { kind: "constant", value: 1 },
            picksSpecId: { kind: "constant", value: "eclipse.predicted-card" },
            choose: { kind: "constant", value: true },
            chooseCount: { kind: "constant", value: { min: 0, max: 1 } },
            choiceId: { kind: "constant", value: "eclipse.predict" },
            pickedKey: { kind: "constant", value: "predicted" },
            choosePicksKey: { kind: "constant", value: "predicted-recycle" }
          },
          picks: [
            {
              id: "eclipse.predicted-card",
              // 主牌库顶 1 张（含顺序），由上游 zoneSlice 顺序提供。
              options: [],
              ordered: true,
              selection: "all",
              zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 1 } }
            }
          ]
        },
        {
          id: "eclipse.predict-recycle",
          // 437.1：选择回收被预测的牌；未选择时 linked 为空数组，回收 0 张是成功的
          // 无操作（417.4）。回收方向固定为对应牌库底（417.1.a）。
          op: "effect.recycle",
          linkedTo: "eclipse.predict-look",
          args: {
            objects: {
              kind: "linked-value",
              instructionId: "eclipse.predict-look",
              key: "predicted-recycle"
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
    "Give a unit -4 :rb_might: this turn.\n" +
    "[Predict]. (Look at the top card of your Main Deck. You may recycle it.)"
} satisfies CardProgram;

export default eclipse;
