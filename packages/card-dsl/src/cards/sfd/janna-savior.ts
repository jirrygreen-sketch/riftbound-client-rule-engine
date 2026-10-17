import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Janna, Savior (sfd-053-221) — Unit, Calm, Janna/Zaun/Champion.
 * energy 3, power 1 (Calm), Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-053-221，逐字）:
 *   "[Reaction] (Play any time, even before spells and abilities resolve, including to a battlefield you control.)\n"
 *   "When you play me, heal your units here, then move an enemy unit from here to its base."
 *
 * 规则依据（CR v1.5）:
 * - [Reaction]（813）：许可类关键词，允许在任意玩家的 Closed State 打出；813.3.a 明确
 *   带 Reaction 的单位仍受单位固有打出位置限制（自己基地或自己控制的战场），与印文
 *   括号里的提醒一致。卡只声明 keyword，展开（continuous.timing）归
 *   effects/keywords/Reaction.ts。
 * - "When you play me"：383.4.a/420.4.a 的 Play Effect，时点 card-played。
 * - "heal your units here"：419.1/419.2 的 Heal 是清除已有 marked damage（不是回复
 *   生命、也不是反向伤害）；"your units here" 是「你控制的、与本卡同一 Location 的
 *   单位」的集合（355.10.d：按特征选出的集合不是目标，因此不带 TargetSpec）。
 *   位置锚点用契约 3.6 的 sameLocationAs: "self"，区域锚点用 zone: "board"。
 *   解释器的运行时 query（effects/interpreter/selectors.ts 的 queryObjects）支持
 *   sameLocationAs 锚点并按锚点 Location 匹配，治疗半段在真实链上可执行；
 *   目标过滤的绑定翻译（translateObjectFilter）尚不接受锚点键，移动半段仍被挡。
 *   已合入的 effect.heal 支持 objects: { kind: "query", filter } 的集合形态。
 * - "then move an enemy unit from here to its base"："then" 是印文的顺序连词、不是
 *   结果引用（移走的单位与治疗没有因果或引用关系），因此两条指令独立执行、
 *   不写 linkedTo（359.3.e.14 要求链接必须真的引用前序结果）。
 *   "an enemy unit from here" 是需要玩家指名的对象（355.5/355.7）→ TargetSpec，
 *   filter 用 controller: "opponent" + sameLocationAs: "self"。
 *   "to its base"：目的地是该单位控制者的基地——已合入的 effect.move 用
 *   to: "controller-base" 表达该语义（按每个被移动对象当前控制者解析），
 *   已在 ven/sky-crusier 等卡使用。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required（复核 2026-10-17）。
 * 已支持部分：原始 effect.heal 在独立链项中经过 ChainEngine.query/queryObjects
 * 验证同地点友军治疗与远端排除；原始 effect.move 的 controller-base（421.1）
 * 在解释器子效果中验证。两者都不是整卡生命周期绑定成功的证据。
 * 仍缺两条独立绑定路径：translateObjectFilter 拒绝移动 TargetSpec 的
 * sameLocationAs: "self"；Reaction 原始展开的 appliesTo: ["card", "activated-ability"]
 * 被 programs/statics.ts 的 staticTarget 拒绝，尚不能注册其持续时序许可（813.1.c）。
 * 治疗 query 的原始锚点保留，controller: "self" 由真实 ChainEngine 归一化。
 * 不近似实现：不把 "here" 近似为无位置过滤、不把 "its base" 写成固定 seat、也不把
 * Heal 当成反向伤害。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "reaction" },
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { event: "card-played", filter: { source: "self" } } },
    optional: false,
    body: [
      {
        id: "janna-savior.heal-units-here",
        op: "effect.heal",
        args: {
          objects: {
            kind: "constant",
            value: {
              kind: "query",
              filter: {
                type: "unit",
                zone: "board",
                controller: "self",
                sameLocationAs: "self"
              }
            }
          },
          linkKey: { kind: "constant", value: "healedHere" }
        }
      },
      {
        id: "janna-savior.move-enemy-home",
        op: "effect.move",
        args: {
          objects: { kind: "constant", value: { target: "janna-savior.enemy-unit-here" } },
          // 421.1/"to its base"：目的地 = 被移动对象控制者的基地。
          to: { kind: "constant", value: "controller-base" },
          linkKey: { kind: "constant", value: "movedEnemy" }
        },
        targets: [
          {
            id: "janna-savior.enemy-unit-here",
            filter: { type: "unit", zone: "board", controller: "opponent", sameLocationAs: "self" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-e34490aeafd0b93f586a5515c869f58c08f344fc4fc7477abdf4e24ada222632",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处绑定缺口：(1) 移动 TargetSpec 的 sameLocationAs: self 锚点（契约 3.6）被 " +
    "programs/filters.ts 的 translateObjectFilter 拒绝：Unsupported filter field sameLocationAs，" +
    "原始触发能力不能注册；治疗 query 本身不被拒绝。(2) [Reaction]（813.1.c）展开的 " +
    "continuous.timing 使用 appliesTo: [card, activated-ability]，programs/statics.ts 的 " +
    "staticTarget 报 Unsupported static appliesTo [\"card\",\"activated-ability\"]，" +
    "因此虽已有 actionTimings/canActByRules 消费方，原始展开仍不能绑定为时序许可。" +
    "已支持部分分别验证：保持 controller: self 与 sameLocationAs: self 的原始治疗指令在" +
    "独立 ChainEngine 链项中正确治疗同地点友军并排除远端友军；原始移动指令在解释器中" +
    "正确移动锁定敌军到 controller-base（421.1）。这些子效果证据不表示整卡绑定已完成。" +
    "不近似实现（不把 here 近似为无位置过滤，不写死 seat 的基地）。",
  abilities,
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve, including to a battlefield you control.)\n" +
    "When you play me, heal your units here, then move an enemy unit from here to its base."
} satisfies CardProgram;

export default program;
