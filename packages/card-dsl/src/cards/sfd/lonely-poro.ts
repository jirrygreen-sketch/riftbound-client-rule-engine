import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Lonely Poro (sfd-036-221) — Unit, Calm, Poro/Freljord.
 * energy 2, power: none printed, Might 2.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-036-221，逐字）:
 *   "[Deathknell] — If I died alone, draw 1. (When I die, get the effect. I'm alone if there are no other friendly units here.)"
 *
 * 规则依据（CR v1.5）:
 * - [Deathknell]（808.1/808.1.c）：触发式能力关键词，功能上等于 "When I die, [Effect]."；
 *   触发点是自身被消灭并送入 Trash（808.1.d、429.1.a.1.b），对应封闭时点 object-killed。
 *   808.1.c.2：Effect 用过去式书写时，指触发进链那一刻的状态——"If I died alone" 是
 *   触发条件，在进链前判定（与已合入 sfd/unsung-hero 的 "If I was [Mighty]" 同型）。
 * - 740.2.a："A unit is alone when there are no other friendly units at the same location."；
 *   因此条件读的是「触发时（进链前）本卡所在地点上没有其他友方单位」，属于触发级别的
 *   位置状态判定（359.3.f.1 referent 的口径：从触发时刻的来源位置读取）。
 * - "draw 1"：414.3/414.1.a；已合入的 effect.draw 只提交 draw GameAction。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - [Deathknell] 的展开体（effects/keywords/Deathknell.ts）只引用 trigger.leave，而该 op
 *   没有已合入的 InstructionDef（effects/instructions/registry.generated.ts 无 trigger.*
 *   条目），卡牌程序的触发也尚未注册进事件管线；808.1.d.1（死亡被替代则移出链）/
 *   808.1.d.2/.d.3（进链前记录 last-known）同样依赖该管线。
 * - 「died alone」的条件（740.2.a）需要「同一位置（sameLocationAs: "source"）且排除自身」
 *   的友方单位计数：解释器的查询锚点支持 sameLocationAs、exclude，但触发进链前的条件
 *   求值路径（事件管线对卡牌程序触发条件的判定）尚未接线，且来源在进链前仍须有可用的
 *   last-known 位置。
 * 依赖：RIFT-82（kw-deathknell-legion）与 RIFT-120（事件管线 trigger.leave / 触发注册 /
 * 进链前条件求值）。draw 1 本体只用已合入的 effect.draw。不近似实现。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "deathknell" },
  {
    kind: "triggered",
    trigger: {
      at: "object-killed",
      filter: { event: "object-killed", filter: { source: "self" } },
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "objects",
          filter: {
            type: "unit",
            controller: "controller",
            zone: "board",
            sameLocationAs: "source",
            exclude: "source"
          }
        },
        operator: "eq",
        right: { kind: "constant", value: 0 }
      }
    },
    optional: false,
    body: [
      {
        id: "lonely-poro.draw-1",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-ead599cc175549f33e7ce605d2fc97d6e65ce56a91ca97055d06554ed4cea1ae",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "[Deathknell]（808.1）的展开不可执行：effects/keywords/Deathknell.ts 的触发体只引用 trigger.leave，" +
    "而该 op 没有已合入的 InstructionDef（effects/instructions/registry.generated.ts 无 trigger.* 条目），" +
    "卡牌程序的触发尚未注册进事件管线；808.1.d.1（死亡被替代则移出链）与 808.1.d.2/.d.3（进链前记录 last-known）同属该管线。" +
    "「If I died alone」的条件（CR 740.2.a：同位置没有其他友方单位；808.1.c.2 的过去式指进链那一刻）" +
    "需要触发进链前的条件求值路径：sameLocationAs/exclude 锚点解释器支持，但事件管线对卡牌程序触发条件的判定未接线；" +
    "且条件里的 controller: \"controller\" 占位符在解释器/条件求值路径上没有归一化（参考内核与 chain 的 query 只归一化 self/opponent），" +
    "计数会落到 0、让条件恒真——在归一化落地前不能宣称该条件可执行。" +
    "依赖：RIFT-82（kw-deathknell-legion）、RIFT-120（trigger.leave / 触发注册 / 进链前条件求值）。" +
    "draw 1 本体只用已合入的 effect.draw。不近似实现（不把「died alone」写成无条件抽牌，也不用近似谓词）。",
  abilities,
  sourceText:
    "[Deathknell] — If I died alone, draw 1. (When I die, get the effect. I'm alone if there are no other friendly units here.)"
} satisfies CardProgram;

export default program;
