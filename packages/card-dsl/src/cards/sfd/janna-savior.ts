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
 * 已合入：RIFT-257 的 programs/triggers.ts 能把 "When you play me"（card-played，
 * 383.4.a/420.4.a）注册进事件管线；effect.heal 的集合 query 与 effect.move 的
 * "controller-base" 目的地（421.1）都真实执行。
 * 仍缺：移动目标过滤（effect.move 的 TargetSpec）里的 "here" 用 sameLocationAs:
 * "self" 锚点，但 programs/filters.ts 的 translateObjectFilter（绑定路径）把锚点键
 * 视为 Unsupported filter field 并转 judge-required，TriggerRegistration 装不上，
 * 移动半段在真实对局里不可达。治疗查询不受该路径影响（effect.heal 的 query 只走
 * 解释器的 queryObjects），controller 占位符也已按链上实际归一化改为 "self"
 * （chain/engine.ts 的 query 包装只把 "self" 归一化成条目控制者）。
 * 依赖：programs/filters.ts 对目标过滤 sameLocationAs 锚点的翻译。
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
    "一处依赖仍未合入：移动目标过滤（effect.move 的 TargetSpec）里的 \"here\" 用 " +
    "sameLocationAs 锚点（契约 3.6），但 RIFT-257 合入的 programs/filters.ts " +
    "（translateObjectFilter）对锚点键直接报 Unsupported filter field 并转 " +
    "judge-required，TriggerRegistration 装不上，移动半段在真实对局里不可达。" +
    "治疗半段不受该绑定路径影响：effect.heal 的 query 只走解释器运行时查询" +
    "（effects/interpreter/selectors.ts 的 queryObjects 支持 sameLocationAs 锚点），" +
    "controller 占位符也已按链上实际归一化改为 self（chain/engine.ts 的 query 包装" +
    "只把 self 归一化成条目控制者），真实链验证同地点友军被治疗、远端友军不受" +
    "影响。body 本体（effect.heal 集合治疗 + effect.move 到 controller-base）与 " +
    "[Reaction] 的时序消费（chain/engine.ts 的 actionTimings/canActByRules 已读图层）" +
    "均已合入。依赖：translateObjectFilter 对目标过滤 sameLocationAs 锚点的翻译。" +
    "不近似实现（不把 here 近似为无位置过滤，不写死 seat 的基地）。",
  abilities,
  sourceText:
    "[Reaction] (Play any time, even before spells and abilities resolve, including to a battlefield you control.)\n" +
    "When you play me, heal your units here, then move an enemy unit from here to its base."
} satisfies CardProgram;

export default program;
