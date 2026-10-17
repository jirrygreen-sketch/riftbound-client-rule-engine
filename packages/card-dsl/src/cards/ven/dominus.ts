import type { CardProgram } from "../../ir/index.js";

/**
 * Dominus (ven-142-166) — Spell, 4 energy, no printed Power（power null 不改成 0）,
 * domains ["Fury", "Body"], tags Renekton/Signature. Might null（法术无印刷 Might）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-142-166，逐字）:
 *   "[Action] (Play on your turn or in showdowns.)\n"
 *   "This turn, double a unit's Might and give it \":rb_rune_rainbow::rb_rune_rainbow:: Ready me.\""
 *
 * 规则依据（CR v1.5）：
 * - [Action]（806）是许可类关键词（159.2.a 的法术内在属性）；卡只声明关键词身份，
 *   展开（continuous.timing 的 showdown 许可）归 effects/keywords/Action.ts 与 chain 的准入。
 * - "double a unit's Might"：433/433.1 把 Doubling 定义为「按属性当前值增加等量」（433.1 的示例
 *   正是 Might 翻倍：3 base + Shield 2 = 当前 5 ⇒ +5 this turn），433.1.a 要求该修改按指定期限
 *   持续。它属算术图层（475 Layers），不是 CR 702 的 Buff 计数（effect.buff 文件头明确
 *   临时 Might 修改归 continuous.might）。被翻倍的单位是目标（355.7/355.9.a.1/355.10）。
 * - "give it \"[A][A]: Ready me.\""：这是给**被选单位**授予一条带费用的启动能力
 *   （399-406 的激活/结算流程；"me" 指被授予能力的主体即该单位，不是本法术）。
 *   费用里的 :rb_rune_rainbow: 是任意域 Power [A]（135.2.e.5/135.2.e.5.a：作为费用可由任意域
 *   Power 支付），用两条 allowedDomains 包含全部六域的 Power 需求表示。
 *   "Ready me" 是 416.1 的就绪动作，
 *   已合入的 effect.ready 的缺省选择即能力来源（"ready me" 同型记录见 sfd/simian-ancestor）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。不近似实现尚缺的能力授予：
 * 缺 continuous.grant-ability 原语：把一条完整启动能力（保留来源、支付、目标与持续期）
 * 授予目标对象的能力边界不存在；effects/instructions/ 的注册表没有该 op（同型记录见
 * sfd/forge-of-the-fluft、rad/heartening-soul）。
 * 已支持部分：condition.value 在结算时冻结目标当前 Might，再以 continuous.might 的 add
 * 模式增加这个固定数值，期限为 this-turn（433.1/433.1.a）；不是持续重算的乘数。
 * [A][A] 费用与 Ready 本体也由现有费用规划器和 effect.ready 支持；整条授予尚未接通。
 * 本文件保留可审查的授予形状（目标 + 费用 + Ready 体 + this-turn 期限），不写成近似实现。
 */
const dominus = {
  canonicalCardId: "card.hash-981bce17b37bbc9e61b2bc56b12191d12b4c0d17be51ad4a950324e1e4941c5a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 continuous.grant-ability 原语，不近似实现——把一条完整启动能力" +
    "（保留来源、支付、目标与持续期，CR 399-406/135.4.b/801.3.a）授予被选单位的能力边界不存在，" +
    "effects/instructions/ 的注册表没有该 op（同型记录见 sfd/forge-of-the-fluft、rad/heartening-soul）。" +
    "翻倍部分已支持：condition.value 冻结结算时当前 Might，continuous.might add 在本回合增加该固定数值" +
    "（433.1/433.1.a），回合结束到期，不用 Buff 计数代替。" +
    "[A][A] 费用已用两条全六域 allowedDomains 的 Power 需求表示（135.2.e.5.a/163.2.b），费用规划可执行。" +
    "「double a unit's Might」与「give it …」共用同一个被选目标（355.7/355.9.a.1）；" +
    "[Action]（806）关键词已合入；授予体里的 Ready（416.1）本身是 effect.ready 的缺省来源选择。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          // 433.1.a：只读一次结算时的当前 Might，之后固定增加该数值。
          id: "dominus.read-might",
          op: "condition.value",
          args: {
            value: {
              kind: "object-attribute",
              object: { target: "dominus.unit" },
              attribute: "might"
            },
            key: { kind: "constant", value: "currentMight" }
          },
          targets: [
            {
              id: "dominus.unit",
              filter: { type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          id: "dominus.double-might",
          op: "continuous.might",
          linkedTo: "dominus.read-might",
          args: {
            mode: { kind: "constant", value: "add" },
            amount: {
              kind: "linked-value",
              instructionId: "dominus.read-might",
              key: "currentMight"
            },
            objects: { kind: "constant", value: { kind: "target", id: "dominus.unit" } },
            duration: { kind: "constant", value: "this-turn" }
          }
        },
        {
          // "give it \"[A][A]: Ready me.\""：把一条启动能力授予同一个被选单位
          // （continuous.grant-ability 缺绑定路径，见 judgeReason）；"me" 指该单位，
          // 因此授予体里的 effect.ready 用缺省来源选择（即被授予能力的宿主）。
          id: "dominus.grant-ready-ability",
          op: "continuous.grant-ability",
          args: {
            target: { kind: "constant", value: "dominus.unit" },
            duration: { kind: "constant", value: "this-turn" },
            ability: {
              kind: "constant",
              value: {
                kind: "activated",
                timing: "action",
                cost: {
                  kind: "activated",
                  // :rb_rune_rainbow::rb_rune_rainbow: = 两点任意域 Power [A]
                  // （135.2.e.5.a / 163.2.b）：每点都可由任意域 Power 支付。
                  payments: [
                    {
                      kind: "power",
                      amount: { kind: "constant", value: 1 },
                      allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]
                    },
                    {
                      kind: "power",
                      amount: { kind: "constant", value: 1 },
                      allowedDomains: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]
                    }
                  ]
                },
                body: [
                  {
                    id: "dominus.granted-ready",
                    op: "effect.ready",
                    args: { objects: { kind: "constant", value: { kind: "source" } } }
                  }
                ]
              }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "This turn, double a unit's Might and give it \":rb_rune_rainbow::rb_rune_rainbow:: Ready me.\""
} satisfies CardProgram;

export default dominus;
