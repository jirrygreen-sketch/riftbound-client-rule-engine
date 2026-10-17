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
 * status 判定（cards/README.md 第 2 节）：judge-required（按 2026-10-17 合入批次复核）。
 * 四处缺口，均不近似实现：
 * 1. [Hunt] 的 KeywordDef 与展开已存在，programs/keywords.ts 也会展开它；但展开写的事件拼写是
 *    "conquer"/"hold"，而封闭 EVENT_PATTERN_TYPES 用的是
 *    "conquered"/"held"（events/trigger-spec.ts + pipeline-match.ts 的 EVENT_NAMES），
 *    registerProgramTriggers 抛 invalid-event-type；conquer 发射也不带征服单位
 *    （turn/flow.ts 的 Score 波只发 player/details），source:"self" 匹配不到（823.1.c.1）。
 * 2. 指令内费用 "spend 3 XP"（740.4.a/740.4.a.2；730.2）没有已注册原语：effects/instructions/
 *    下没有 cost.xp，cost/ 也没有把该支付变成 Finalize 可选选择 + 回执的接线。
 *    "you may" 的拒绝路径因此不可执行；golden 只断言声明的形状。
 * 3. attack-declared 时点没有生产者：docs/rules/timing-point-producers.md 记为“待后续——需要
 *    Combat start/role designation 的原子 timing wave”，combat/flow.ts 明确抛
 *    combat-start-transaction。
 * 4. 两条声明都无法注册：Hunt 的 "conquer"/"hold" 拼写不在封闭词汇表内，攻击触发的 body
 *    又带 sameLocationAs 过滤键（programs/filters.ts 拒绝）；虽然 engine-core 的 TargetSpec
 *    位置解析已有 location-of 运行时能力，但当前 card-dsl 校验仍把该相对位置当作
 *    LocationFilter 拒绝，不能在本卡内借此绕过 sameLocationAs 缺口。
 * body 的 effect.damage（动态 Might 数额 + sameLocationAs 锚点）已合入，golden 用链适配器 +
 * 参考内核真实执行卡程序原始参数；"pay 3 XP to" 的代价目前只以未注册的 cost.xp 指令形状保留
 * （见 judgeReason 第 2 点），没有近似成其它原语。
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
    "四处缺口（已按 2026-10-17 合入批次复核）：(1) [Hunt]（823）的 KeywordDef 与展开已存在，且 " +
    "programs/keywords.ts 会展开它，但展开写的事件拼写是 \"conquer\"/\"hold\"，封闭 EVENT_PATTERN_TYPES（events/trigger-spec.ts，" +
    "配 pipeline-match.ts 的 EVENT_NAMES 别名）用的是 \"conquered\"/\"held\"，registerProgramTriggers 抛 invalid-event-type；" +
    "conquer 发射也不带征服单位（turn/flow.ts 的 Score 波只发 player/details），source:\"self\" 匹配不到（823.1.c.1）。" +
    "(2) 指令内费用「spend 3 XP」（740.4.a、740.4.a.2；730.2 的花费方向）仍没有已注册原语：" +
    "effects/instructions/ 下没有 cost.xp，cost/ 也没有把该支付变成 Finalize 可选选择与回执的接线" +
    "\"you may\" 的拒绝路径因此不可执行。" +
    "(3) attack-declared 时点（383.4.e 的 Attack Trigger）没有生产者：docs/rules/timing-point-producers.md 记为待后续，" +
    "combat/flow.ts 遇到 staged combat 直接抛 combat-start-transaction。" +
    "(4) 触发没有可用注册路径：Hunt 展开的 " +
    "\"conquer\"/\"hold\" 拼写不被封闭 EVENT_PATTERN_TYPES 接受，body 的 sameLocationAs 过滤键也被 " +
    "programs/filters.ts 拒绝；engine-core 虽已具备 TargetSpec 的 location-of 运行时解析，当前 card-dsl 校验仍把该相对位置当作 " +
    "LocationFilter 拒绝，无法在本卡内绕过 sameLocationAs 缺口。" +
    "effect.damage 的动态 Might 数额与 sameLocationAs 锚点已合入并在 golden 中真实执行（卡程序原始参数）。不近似实现。",
  abilities,
  sourceText:
    "[Hunt] (When I conquer or hold, gain 1 XP.)\n" +
    "When I attack, you may spend 3 XP to deal damage equal to my Might to an enemy unit here."
} satisfies CardProgram;
