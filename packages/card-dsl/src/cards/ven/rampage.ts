import type { CardProgram } from "../../ir/index.js";

/**
 * Rampage（ven-083-166）— Spell，3 Energy，无印刷 Power，领域 Body。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-083-166，逐字）：
 *   "As you play this, you may pay :rb_rune_body: as an additional cost.\n"
 *   "Choose a friendly unit and an enemy unit. If you paid the additional cost, "
 *   "give the friendly unit +2 :rb_might: this turn. They deal damage equal to "
 *   "their Mights to each other."
 *
 * 规则依据（Core Rules v1.5）：
 * - "As you play this, you may pay :rb_rune_body: as an additional cost."：打出该牌时由被动能力
 *   给出的可选追加费用（356.2.b / 356.2.b.1）；支付决定属于打出流程的费用步骤（355.1.a），
 *   组件在 356.2 生效。:rb_rune_body: 是 1 点 Body Power（135.2.e.4 的域 Power 符号 +
 *   134.2.d 的 Body 符号），因此按调用方传入的可选追加费用形状声明为 play 的 CostSpec
 *   （与 ogn-207-298 Call to Glory 的 "explicit" + payments 写法一致），印刷基础费用 3 Energy
 *   同时记录；该声明目前只是数据（见 judgeReason 第 1 条）。
 * - "Choose a friendly unit and an enemy unit."：两个具体对象都是 Target（355.7；355.9.a.1
 *   的 "unit" 指 Board 对象；355.9.b 的 friendly/enemy 是 targeting restriction），在 Finalize
 *   锁定（355.5 / 355.8）。
 * - "give the friendly unit +2 :rb_might: this turn"：带回合期限的临时 Might 修正；243.2.a 的
 *   有效 Might 读数、317.2.c 在回合结束 3d 步骤同时到期，属 arithmetic 图层（478 / 478.1.a）。
 * - "They deal damage equal to their Mights to each other."：CR 418.6.b.3 以本类文本为范例
 *   （"The damage ... is dealt by the chosen units"），418.6.b.4 让各自的控制者负责；因此两条
 *   effect.damage 分别以其中一个单位为 source、并在结算时读取它自己的 Might 作为数额
 *   （契约 3.6：表达式取值时机即调用时）。418.1.c 分别标记伤害；418.1.d 的同时性由内核表达。
 *   两条指令互不链接（359.2.c 尽可能执行）。
 *
 * 当前状态与剩余接线见 judgeReason；不以原语存在代替整卡执行证据。
 */
const rampage = {
  canonicalCardId: "card.hash-9c6aa95845a73edcec9a9568deba187100fbe690f0a6dfcc010810f04e6a9245",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺卡程序到可选追加费用的 Finalize 绑定：CR 356.2.b 的 1 Body Power 必须生成 CostPlanInput.optionalAdditional；当前 payments.power.choice 是描述性 pay/decline 数据，cost/plan-values.ts 不接受 Power payment 带 choice，不能当成已绑定费用。condition.result 与 chain/engine.ts 的 cost plan/payment receipt 转发已合入，+2 continuous.might 现按 356.4.f.1 的 cost.additional 回执门控，付费/拒付/折扣到零有真实计划与解释器证据。完整互伤还须验证图层有效 Might 的读取、双向伤害的同一结算组（418.1.d），以及重复目标声明的 Finalize 计划。保留 judge-required，不近似实现。",
  abilities: [
    {
      kind: "play",
      // 印刷基础费用 3 Energy（power: null 表示无印刷 Power，不写成 0）+ 356.2.b 的可选追加费用。
      // 该 CostSpec 目前没有卡牌侧消费方（见 judgeReason 第 1 条），只作可审查数据。
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 3 },
        payments: [
          {
            kind: "power",
            amount: { kind: "constant", value: 1 },
            // :rb_rune_body: = 1 点 Body Power（134.2.d / 135.2.e.4）。
            allowedDomains: ["Body"],
            choice: {
              id: "rampage.pay-or-decline",
              options: ["pay", "decline"],
              min: 1,
              max: 1,
              selection: "one"
            }
          }
        ]
      },
      body: [
        {
          id: "rampage.give-friendly-plus-2",
          // "If you paid the additional cost, give the friendly unit +2 Might this turn"：带期限的
          // 临时 Might 修正（317.2.c 到期），按已支付的可选追加费用回执门控。
          op: "continuous.might",
          condition: { kind: "result", result: "cost.additional", id: "rampage.pay-or-decline" },
          args: {
            amount: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "this-turn" },
            target: { kind: "constant", value: "rampage.friendly-unit" }
          },
          targets: [
            {
              id: "rampage.friendly-unit",
              // "a friendly unit"：由本能力控制者控制的 Board 单位（355.9.a.1/355.9.b）。
              filter: { type: "unit", zone: "board", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "They deal damage equal to their Mights to each other." 第一条 Deal：友方单位以
          // 自己的（结算时）Might 对敌方单位造成伤害，来源就是它自己（418.6.b.3）。
          id: "rampage.friendly-deals",
          op: "effect.damage",
          args: {
            amount: {
              kind: "object-property",
              object: { target: "rampage.friendly-unit" },
              property: "might"
            },
            source: {
              kind: "object-property",
              object: { target: "rampage.friendly-unit" },
              property: "ref"
            },
            target: { kind: "constant", value: "rampage.enemy-unit" }
          },
          targets: [
            {
              id: "rampage.enemy-unit",
              filter: { type: "unit", zone: "board", controller: "opponent" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // 第二条 Deal：敌方单位以自己的 Might 对友方单位造成伤害。
          id: "rampage.enemy-deals",
          op: "effect.damage",
          args: {
            amount: {
              kind: "object-property",
              object: { target: "rampage.enemy-unit" },
              property: "might"
            },
            source: {
              kind: "object-property",
              object: { target: "rampage.enemy-unit" },
              property: "ref"
            },
            target: { kind: "constant", value: "rampage.friendly-unit" }
          },
          targets: [
            {
              id: "rampage.friendly-unit",
              filter: { type: "unit", zone: "board", controller: "self" },
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
    "As you play this, you may pay :rb_rune_body: as an additional cost.\n" +
    "Choose a friendly unit and an enemy unit. If you paid the additional cost, " +
    "give the friendly unit +2 :rb_might: this turn. They deal damage equal to " +
    "their Mights to each other."
} satisfies CardProgram;

export default rampage;
