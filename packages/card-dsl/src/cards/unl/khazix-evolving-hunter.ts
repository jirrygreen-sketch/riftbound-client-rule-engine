import type { Ability, CardProgram, Instruction } from "../../ir/index.js";

/**
 * Kha'Zix, Evolving Hunter (unl-119-219) — Unit，能量 5，力量 1，Might 5，领域 Body，
 * 标签 Kha'Zix/The Void/Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-119-219，逐字）:
 *   "[Hunt] (When I conquer or hold, gain 1 XP.)\n" +
 *   "When I attack, you may spend 3 XP to deal damage equal to my Might to an enemy unit here."
 *
 * 规则依据（CR v1.5）:
 * - [Hunt]：823.1.a-c；省略数值时按 1 处理（823.1.c.2），823.2 多个 Hunt 数值相加，
 *   823.3 可引用特征。卡文件只声明不带数值的 keyword（契约 3.1/3.7）。提醒文字是提醒
 *   文本（135.2.d.3）。
 * - "When I attack"：383.4.e 的 Attack Trigger（单位取得 attacker designation 后作为
 *   Pending Item 入链）；封闭时点是 attack-declared（events/timing-points.ts，ruleRefs
 *   466.x/468.x 的战斗事务；docs/rules/timing-point-producers.md 记为待后续）。
 * - "you may spend 3 XP to deal damage …"：740.4.a 的“指令内费用”（"[do X] to [do Y]"，
 *   [do X] 是费用、[do Y] 是效果）；740.4.a.2 规定触发式能力第一部分的指令内费用在该触发
 *   finalize 时支付。费用是 3 XP（730.2 的花费方向），支付与否用 740.4.a 的 "you may"。
 * - "deal damage equal to my Might"：418.1（Deal 动作）与 143.2（Might 是可被引用的
 *   战斗属性）；用已合入的 effect.damage 的动态数额 object-property(object: "source",
 *   property: "might")，结算时经 ctx.evaluate 取值（契约 3.6）。
 * - "an enemy unit here"：355.7/355.9.a 的目标；"here" 是 359.3.f 的指代，用契约 3.6 的
 *   sameLocationAs: "source" 锚点表达（与已合入的 rad/ezreal-dashing 同型）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。四处缺口，均不近似实现：
 * 1. [Hunt]（823）没有已合入的 KeywordDef："When I Conquer or Hold, my controller gains
 *    1 XP" 需要 conquer / hold 时点（383.4.c/383.4.d）与关键词展开接线，而 scoring/ 未接入
 *    唯一事件管线（RIFT-33/RIFT-120）。
 * 2. 指令内费用 "spend 3 XP" 没有已合入原语：effects/instructions/ 下没有 cost.xp 文件
 *    （RIFT-9 原语清单里的 cost.xp；调研记为本卡的 directPrimitive），Finalize 侧也没有把
 *    该费用的支付决定变成可选选择与回执的接线，"you may" 的拒绝路径因此不可执行。
 * 3. attack-declared 时点没有生产者：docs/rules/timing-point-producers.md 把它记为
 *    “待后续——需要 Combat start/role designation 的原子 timing wave”，combat/ 未接入唯一
 *    事件管线（契约 §7.2 批 5，RIFT-33/RIFT-120）。
 * 4. 缺 CardProgram → TriggerRegistration 适配器（RIFT-120 后续），触发能力没有注册路径。
 * body 的 effect.damage（动态 Might 数额 + sameLocationAs 锚点）已合入，golden 用解释器 +
 * 参考内核真实执行；"pay 3 XP to" 的代价用 cost.xp 形状记录在指令的 cost 字段（不注册为
 * 指令 op，避免发明语义），见 judgeReason 第 2 点。
 */
const ENEMY_UNIT_HERE = "khazix-evolving-hunter.enemy-unit-here";

const dealDamage: Instruction = {
  id: "khazix-evolving-hunter.deal-might-damage",
  op: "effect.damage",
  args: {
    // "equal to my Might"：结算时读取来源当前 Might（契约 3.6 evaluate 时机）。
    amount: { kind: "object-property", object: "source", property: "might" },
    target: { kind: "constant", value: ENEMY_UNIT_HERE }
  },
  targets: [
    {
      id: ENEMY_UNIT_HERE,
      // "an enemy unit here"：对手控制、与来源同位置的单位（359.3.f 的 here 指代）。
      filter: { type: "unit", controller: "opponent", sameLocationAs: "source" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]
};

const abilities: Ability[] = [
  // 823.1.c.2：印刷省略数值，按 Hunt 1 处理（展开由关键词注册表负责）。
  { kind: "keyword", keyword: "hunt" },
  {
    kind: "triggered",
    trigger: {
      at: "attack-declared",
      filter: { event: "attack-declared", filter: { source: "self", player: "controller" } }
    },
    // 740.4.a.2：指令内费用在该触发 finalize 时支付；"you may" 的拒绝路径归费用管线。
    // 被选中的内容按契约 3.9 包进 choice.optional 的 body。
    optional: true,
    body: [
      {
        id: "khazix-evolving-hunter.may-spend-xp",
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Spend 3 XP to deal damage equal to my Might?" },
          body: {
            kind: "constant",
            value: [
              {
                // "spend 3 XP"：730.2 的花费方向属费用计划（cost.xp），不是效果原语，
                // 因此这里不写成 effect.* 指令；该 op 尚未合入（见 judgeReason 第 2 点）。
                id: "khazix-evolving-hunter.spend-3-xp",
                op: "cost.xp",
                args: {
                  amount: { kind: "constant", value: 3 },
                  player: { kind: "constant", value: "controller" },
                  linkKey: { kind: "constant", value: "spentXp" }
                }
              },
              {
                // "to deal damage …"：只有费用真的支付后才造成伤害（740.4.a 的 [do X] to [do Y]）。
                ...dealDamage,
                condition: {
                  kind: "compare",
                  left: {
                    kind: "linked-value",
                    instructionId: "khazix-evolving-hunter.spend-3-xp",
                    key: "spentXp"
                  },
                  operator: "gte",
                  right: { kind: "constant", value: 3 }
                }
              }
            ]
          }
        }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-3909cd8333cf6abffca3ccc632c393edd64ca5fb88d9da9db4f7b40d400e6778",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口：(1) [Hunt]（823）没有已合入的 KeywordDef：「When I Conquer or Hold, my controller gains 1 XP」" +
    "（823.1.c.1/.c.2）需要 conquer/hold 时点与关键词展开接线，scoring/ 未接入唯一事件管线（RIFT-33/RIFT-120）。" +
    "(2) 指令内费用「spend 3 XP」（740.4.a、740.4.a.2；730.2 的花费方向）没有已合入原语：" +
    "effects/instructions/ 下没有 cost.xp 文件（RIFT-9 清单记为本卡的 directPrimitive），" +
    "Finalize 侧也没有把该支付决定变成可选选择与回执的接线，\"you may\" 的拒绝路径因此不可执行。" +
    "(3) attack-declared 时点（383.4.e 的 Attack Trigger）没有生产者：docs/rules/timing-point-producers.md 记为待后续，" +
    "combat/ 未接入唯一事件管线（RIFT-33/RIFT-120）。(4) 缺 CardProgram → TriggerRegistration 适配器（RIFT-120 后续）。" +
    "effect.damage 的动态 Might 数额与 sameLocationAs 锚点已合入并在 golden 中真实执行。不近似实现。",
  abilities,
  sourceText:
    "[Hunt] (When I conquer or hold, gain 1 XP.)\n" +
    "When I attack, you may spend 3 XP to deal damage equal to my Might to an enemy unit here."
} satisfies CardProgram;
