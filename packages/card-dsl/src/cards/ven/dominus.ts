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
 *   Power 支付）；契约 3.6 的封闭 Domain 集合（Fury/Calm/Mind/Body/Chaos/Order）没有 [A] 值，
 *   effect.resources 明确记录 [A] 绝不近似为某个域。"Ready me" 是 416.1 的就绪动作，
 *   已合入的 effect.ready 的缺省选择即能力来源（"ready me" 同型记录见 sfd/simian-ancestor）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。两处依赖未合入，均不近似实现：
 * (1) 缺 continuous.grant-ability 原语：把一条完整启动能力（保留来源、支付、目标与持续期）
 *     授予目标对象的能力边界不存在；effects/instructions/ 的注册表没有该 op（同型记录见
 *     sfd/forge-of-the-fluft、rad/heartening-soul）。
 * (2) 缺临时 Might 翻倍的可执行路径：continuous.might 已注册，但 mode 只接受 add|set
 *     （parseArgs 与 execute 对 multiply 均拒绝），factor 也不是合法参数键；433/433.1 的
 *     Doubling 因此不可表达；不近似为 effect.buff 计数。
 * [A] 任意域 Power（135.2.e.5.a/163.2.b）在六域封闭集合中没有可执行值，授权体保留
 * ["rainbow","rainbow"] 描述性记号；{kind:"power", amount, allowedDomains} 费用形状本身
 * 已可表达（defender-of-tomorrow golden 同型已证）。
 * 本文件保留可审查的授予形状（目标 + 费用 + Ready 体 + this-turn 期限），不写成近似实现。
 */
const dominus = {
  canonicalCardId: "card.hash-981bce17b37bbc9e61b2bc56b12191d12b4c0d17be51ad4a950324e1e4941c5a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖未合入，均不近似实现：(1) 缺 continuous.grant-ability 原语——把一条完整启动能力" +
    "（保留来源、支付、目标与持续期，CR 399-406/135.4.b/801.3.a）授予被选单位的能力边界不存在，" +
    "effects/instructions/ 的注册表没有该 op（同型记录见 sfd/forge-of-the-fluft、rad/heartening-soul）。" +
    "(2) 缺临时 Might 翻倍的可执行路径：433/433.1 的 Doubling 属算术图层（475），" +
    "continuous.might 已注册，但 mode 只接受 add|set——parseArgs 与 execute 对 multiply 均拒绝，" +
    "factor 也不是合法参数键，倍增因此不可表达；不近似为 effect.buff 计数。" +
    "[A] 任意域 Power（135.2.e.5.a/163.2.b）在六域封闭 Domain 集合中没有可执行值，" +
    "effect.resources 明确记录绝不用某个域近似；{kind:\"power\", amount, allowedDomains} 费用形状" +
    "本身可表达（defender-of-tomorrow golden 同型已证）。" +
    "「double a unit's Might」与「give it …」共用同一个被选目标（355.7/355.9.a.1）；" +
    "[Action]（806）关键词已合入；授予体里的 Ready（416.1）本身是 effect.ready 的缺省来源选择。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          // "This turn, double a unit's Might"：433.1 的算术层倍增 + this-turn 期限；
          // continuous.might 只接受 add|set（见 judgeReason 第 2 点）。
          id: "dominus.double-might",
          op: "continuous.might",
          args: {
            mode: { kind: "constant", value: "multiply" },
            factor: { kind: "constant", value: 2 },
            duration: { kind: "constant", value: "this-turn" }
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
          // "give it \"[A][A]: Ready me.\""：把一条启动能力授予同一个被选单位
          // （continuous.grant-ability 未注册，见 judgeReason 第 1 点）；"me" 指该单位，
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
                  // （135.2.e.5.a / 163.2.b）；六域封闭集合下没有可执行值，
                  // 这里保留描述性记号（无消费方）。
                  power: { kind: "constant", value: ["rainbow", "rainbow"] }
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
