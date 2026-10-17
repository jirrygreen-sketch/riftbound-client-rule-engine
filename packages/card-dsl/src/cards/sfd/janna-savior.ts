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
 * status 判定（cards/README.md 第 2 节）：judge-required（复核 2026-10-16）。
 * 已合入：RIFT-257 的 programs/triggers.ts 能把 "When you play me"（card-played，
 * 383.4.a/420.4.a）注册进事件管线；effect.heal 的集合 query 与 effect.move 的
 * "controller-base" 目的地（421.1）都真实执行。
 * 仍缺：(1) 两条指令的过滤里 "here" 用 sameLocationAs: "self" 锚点，但
 * programs/filters.ts 的 translateObjectFilter 把锚点键视为 Unsupported filter
 * field 并在注册/绑定时报 judge-required——target 过滤与 heal 的 query 都会
 * 走到这条翻译路径；(2) [Reaction] 的 continuous.timing 展开（813.1.c）虽由
 * RIFT-258 合入图层指令，但 chain.canAct 的时序查询（P0 契约 3.5）尚未消费它，
 * 带 Reaction 的单位在 Closed State 的打出许可无法裁决。
 * 依赖：programs/filters.ts 对 sameLocationAs 锚点的翻译（含 trigger 与
 * instruction 两条路径）、chain.canAct 的 continuous.timing 消费（RIFT-91 后续）。
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
                controller: "controller",
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
    "两处依赖仍未合入：(1) 两条指令的 \"here\" 过滤用 sameLocationAs 锚点（契约 3.6），" +
    "但 RIFT-257 合入的 programs/filters.ts（translateObjectFilter）对锚点键直接报 " +
    "Unsupported filter field 并转 judge-required——effect.heal 的 query 与 effect.move 的目标过滤在绑定/注册时都会失败" +
    "（need：锚点在 instructions/trigger 两条翻译路径落地）。" +
    "(2) [Reaction]（813.1.c）的 continuous.timing 展开（RIFT-258 已合入图层指令）还没有 chain.canAct 的时序消费方（P0 契约 3.5），" +
    "Closed State 的打出许可无法裁决。body 本体（effect.heal 集合治疗 + effect.move 到 controller-base）已合入，" +
    "golden 用解释器与真实查询路径执行。依赖：sameLocationAs 的 binding 翻译、chain.canAct 的 continuous.timing 消费。" +
    "不近似实现（不把 here 近似为无位置过滤，不写死 seat 的基地）。",
  abilities,
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve, including to a battlefield you control.)\n" +
    "When you play me, heal your units here, then move an enemy unit from here to its base."
} satisfies CardProgram;

export default program;
