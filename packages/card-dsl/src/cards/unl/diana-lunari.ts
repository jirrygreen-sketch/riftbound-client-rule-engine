import type { CardProgram } from "../../ir/index.js";

/**
 * Diana, Lunari (unl-079-219) — Unit，3 能量、无印刷 Power、Might 3，
 * Mind / Diana / Mount Targon / Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，unl-079-219，逐字）：
 *   When a showdown begins here, you may pay :rb_energy_1:. If you do, [Predict],
 *   then reveal the top card of your Main Deck. If it's a spell, draw it. (To
 *   Predict, look at the top card of your Main Deck. You may recycle it.)
 *
 * 规则依据（CR v1.5）：
 * - 383.4："When a showdown begins" 是 Showdown 开启触发；时点取封闭枚举里的
 *   showdown-open（ruleRefs 345 / 466.2.b），"here"（053.3）指与来源同地点。
 * - 383.3.a.3："you may pay :rb_energy_1:" 位于效果开头，按 383.3.a.1 / 383.3.a.2
 *   是 Finalize 的"是否执行该触发"决定；383.3.b 把紧跟其后的费用视为该触发能力的基础费用。
 *   按契约 3.9，被选指令包进 choice.optional 的 body（不写 choice + linkedTo）。
 * - 437.1 / 437.3.a：Predict = 看牌库顶一张并选择是否回收它（未写数值按 1）。
 * - 425.1 / 425.2.a："reveal the top card of your Main Deck" 是把该牌对全体公开；
 *   牌库顶是按区域顺序取牌（契约 3.6 的 zoneSlice 语义），"your" = 能力控制者（190.6.d）。
 * - 425.4.a / 414.1："If it's a spell, draw it" 把那张已展示的牌拿进手牌。
 *
 * status = judge-required（缺口不近似实现）：
 * 1. 前导 Energy 费用（383.3.b）在冻结 IR 的 triggered ability 里没有 cost 字段；
 *    cost.pay 原语已经合入，但 Finalize 仍没有把触发费用计划传入该形状，因此只能用
 *    choice.optional 表达"是否执行"这一半。
 * 2. Predict 是 437 的动作组合而非 KeywordDef；本卡已直接使用合入的
 *    effect.inspect + effect.recycle 表达查看牌库顶一张与可回收两步。
 * 3. "the top card of your Main Deck" 的按序取值仍缺上游有序来源：effect.reveal 在
 *    非手牌区域取真子集时要求上游 ordered picks（其自身文档与 RIFT-64 记录一致），
 *    且 effect.reveal 的 pick 字段在链式适配器（chain/interpreter-adapter.ts 的
 *    LITERAL_FIELDS）里未解码，派发时会以 "pick must be a non-empty id" 拒绝。
 * 4. 触发过滤 sameLocationAs: "source"（"here"）会被触发 ObjectFilter 的翻译层拒绝，
 *    绑定即失败。
 * 依赖：RIFT-64（有序牌库顶查看）、RIFT-89（费用计划）、翻译层 sameLocationAs。
 * golden 用解释器 + 参考内核真实执行已支持部分（Predict 的 inspect/recycle 两步、
 * reveal 的 pick 路径、spell 分支的 in 成员比较与 effect.zone 取到手牌）。
 */
const dianaLunari = {
  canonicalCardId: "card.hash-f83cd99eea8e6b934368e1c00b331e03a1c952b11ab89154b7e930740ea0552f",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口，均不近似实现：(1) 前导 Energy 费用（383.3.b）在冻结 IR 的 triggered ability 里没有 cost 字段；cost.pay 原语已合入，但 Finalize 尚未把费用计划传入该形状（RIFT-89）；" +
    "(2) Predict 的 inspect/recycle 组合已由本卡直接表达并在 golden 中真实执行，仍缺 showdown-open 触发与卡牌程序绑定；" +
    "(3)「the top card of your Main Deck」的按序取值缺上游有序来源（effect.reveal 对非手牌真子集要求有序 picks，RIFT-64），" +
    "且 effect.reveal 的 pick 字段在 chain/interpreter-adapter.ts 的 LITERAL_FIELDS 里未解码，派发会以 pick must be a non-empty id 拒绝；" +
    "(4) 触发过滤 sameLocationAs: source（here）会被触发 ObjectFilter 的翻译层拒绝，绑定即失败。" +
    "依赖：RIFT-64、RIFT-89、翻译层 sameLocationAs。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "showdown-open",
        filter: { event: "showdown-open", filter: { type: "unit", sameLocationAs: "source" } }
      },
      optional: false,
      body: [
        {
          id: "diana-lunari.may-pay-and-predict",
          // 383.3.a.3 / 契约 3.9："you may pay … If you do, [Predict] …" 的"可以"包住
          // 被选指令；拒绝只是本条 negated(skipped)，其后指令照常结算。
          op: "choice.optional",
          args: {
            prompt: { kind: "constant", value: "Pay 1 energy, then Predict?" },
            body: {
              kind: "constant",
              value: [
                {
                  id: "diana-lunari.bind-controller",
                  // effect.inspect 需要显式 player："your Main Deck" 的 you = 能力控制者
                  // （190.6.d），用契约 3.6 的 "source" 选择器求值后再经 condition.value
                  // 绑定给后续指令读取。
                  op: "condition.value",
                  args: {
                    value: { kind: "object-property", object: "source", property: "controller" },
                    key: { kind: "constant", value: "controller" }
                  }
                },
                {
                  id: "diana-lunari.predict-look",
                  // 437.1 / 437.3.a：[Predict] = 看牌库顶一张，并选择是否回收它。
                  op: "effect.inspect",
                  linkedTo: "diana-lunari.bind-controller",
                  args: {
                    player: {
                      kind: "linked-value",
                      instructionId: "diana-lunari.bind-controller",
                      key: "controller"
                    },
                    zone: { kind: "constant", value: "deck" },
                    scope: { kind: "constant", value: "top" },
                    amount: { kind: "constant", value: 1 },
                    picksSpecId: { kind: "constant", value: "diana-lunari.predicted" },
                    choose: { kind: "constant", value: true },
                    chooseCount: { kind: "constant", value: { min: 0, max: 1 } },
                    pickedKey: { kind: "constant", value: "predicted" },
                    choosePicksKey: { kind: "constant", value: "recycled" }
                  },
                  picks: [
                    {
                      id: "diana-lunari.predicted",
                      // 牌库顶 1 张（含顺序）由上游按区域顺序提供；不从 query 推断顺序。
                      options: ["top-card-of-your-main-deck-in-zone-order"],
                      min: 1,
                      max: 1,
                      selection: "all",
                      filter: { owner: "self", zone: "deck" }
                    }
                  ]
                },
                {
                  id: "diana-lunari.predict-recycle",
                  // 437.1：选择回收的牌放回牌库底（417.1.a 的回收语义）。
                  op: "effect.recycle",
                  linkedTo: "diana-lunari.predict-look",
                  args: {
                    objects: {
                      kind: "linked",
                      instructionId: "diana-lunari.predict-look",
                      key: "recycled"
                    }
                  }
                },
                {
                  id: "diana-lunari.reveal-top",
                  // 425.1 / 425.2.a：把该项牌对全体公开；"the top card" 的顺序取值
                  // 由上游有序 pick 提供（见 judgeReason 第 3 点）。
                  op: "effect.reveal",
                  linkedTo: "diana-lunari.predict-recycle",
                  args: { pick: { kind: "constant", value: "diana-lunari.revealed-top" } },
                  picks: [
                    {
                      id: "diana-lunari.revealed-top",
                      options: ["top-card-of-your-main-deck-in-zone-order"],
                      min: 1,
                      max: 1,
                      selection: "one",
                      filter: { owner: "self", zone: "deck" }
                    }
                  ]
                },
                {
                  id: "diana-lunari.draw-if-spell",
                  // "If it\'s a spell, draw it."：条件是那张被展示牌的 types 含 spell，
                  // 动作用 effect.zone 把它取到手牌（425.4.a / 414.1）。成员判定的
                  // spell 分支的 in 成员比较可执行（golden 已验证）；这里按可审查形状书写。
                  op: "sequence",
                  condition: {
                    kind: "compare",
                    left: { kind: "constant", value: "spell" },
                    operator: "in",
                    right: {
                      kind: "object-property",
                      object: { linked: "diana-lunari.reveal-top" },
                      property: "types"
                    }
                  },
                  args: {
                    body: {
                      kind: "constant",
                      value: [
                        {
                          id: "diana-lunari.draw-revealed",
                          op: "effect.zone",
                          linkedTo: "diana-lunari.reveal-top",
                          args: {
                            pick: { kind: "constant", value: "diana-lunari.revealed-top" },
                            to: { kind: "constant", value: "hand" },
                            amount: { kind: "constant", value: 1 }
                          }
                        }
                      ]
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
    "When a showdown begins here, you may pay :rb_energy_1:. If you do, [Predict], then reveal the top card of your Main Deck. If it's a spell, draw it. (To Predict, look at the top card of your Main Deck. You may recycle it.)"
} satisfies CardProgram;

export default dianaLunari;
