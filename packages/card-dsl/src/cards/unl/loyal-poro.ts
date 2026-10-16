import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Loyal Poro (unl-156-219) — Unit, Order, tags Poro/Freljord.
 * energy 3（power: null，无印刷力量费）, Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-156-219，逐字）：
 *   [Deathknell][>] If I didn't die alone, draw 1. (When I die, get the effect. I wasn't alone if
 *   there were other friendly units here.)
 *
 * 规则依据（CR v1.5）：
 * - [Deathknell]（808.1/808.1.c：功能上等于 “When I die, [Effect]”；808.1.d / 429.1.a.1.b：
 *   死亡触发在替代处理后、实际换区前收集）是触发式能力关键词；[Effect] 正文由卡牌程序持有，
 *   时点用封闭枚举的 object-killed。
 * - 808.1.c.2：Effect 用过去式书写时，指触发进链那一刻的状态——“If I didn't die alone” 因此是
 *   触发条件，在进链前判定（与已合入 sfd/lonely-poro 的 “If I died alone”、sfd/unsung-hero 的
 *   “If I was [Mighty]” 同型）。
 * - 740.2.a：一个单位在“同一位置上没有其他友方单位”时是 alone；本卡是它的否定形，
 *   故条件为“同位置的己方单位（排除自身）数量 ≥ 1”，用 count + sameLocationAs/exclude 锚点表达。
 * - “draw 1”：414.1 / 414.3，用已合入的 effect.draw；缺省抽牌者是能力控制者（190.6.d 的隐含 “you”）。
 *
 * status = judge-required（缺口不近似实现）：
 * - [Deathknell] 的展开体（effects/keywords/Deathknell.ts）只引用 trigger.leave，而该 op 没有已合入的
 *   InstructionDef，卡牌触发也没有注册进事件管线的入口；808.1.d.1（死亡被替代则移出链）与
 *   808.1.d.2/.d.3（进链前记录 last-known）同属该管线。
 * - “didn't die alone” 的触发条件需要按 808.1.c.2 在进链前求值，并使用来源的 last-known 位置
 *   （808.1.d.3）：事件管线对带 condition 的注册要求 host.testTrigger 适配器，已合入 host 都不提供；
 *   条件里的 controller: \"controller\" 占位在参考内核/条件求值路径上也没有归一化
 *   （参考内核按值比较，链的 query 只归一化 \"self\"/\"opponent\"），计数会落到 0 而让条件恒假——
 *   在归一化落地前不能宣称该条件可执行。
 * 依赖：RIFT-82（deathknell 展开）、RIFT-257/120（卡牌触发注册与进链前条件求值、占位归一化）。
 * draw 1 本体（effect.draw）已合入，golden 用解释器 + 参考内核真实执行该半段。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "deathknell" },
  {
    kind: "triggered",
    trigger: {
      at: "object-killed",
      filter: { self: true },
      // 808.1.c.2：“If I didn't die alone” 是过去式，属触发条件（进链前判定）。
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "objects",
          filter: {
            // 740.2.a 的否定形：同一位置上有其他友方单位。
            type: "unit",
            controller: "controller",
            zone: "board",
            sameLocationAs: "source",
            exclude: "source"
          }
        },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
    },
    optional: false,
    body: [
      {
        id: "loyal-poro.draw-1",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

export default {
  canonicalCardId:
    "card.hash-189fb540b58840dbea672bf530705d9fc1548c9fb015ca1b98912e7e4bff7fc1",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口（均不近似实现）：(1) [Deathknell]（808.1）的展开不可执行——effects/keywords/Deathknell.ts 的触发体只引用 trigger.leave，" +
    "该 op 没有已合入的 InstructionDef（effects/instructions/registry.generated.ts 无 trigger.* 条目），" +
    "卡牌触发也没有注册进事件管线的入口；808.1.d.1 与 808.1.d.2/.d.3 同属该管线。" +
    "(2) “If I didn't die alone” 是触发条件（808.1.c.2 的过去式；740.2.a 的 alone 之否定），" +
    "需要在进链前用来源的 last-known 位置求值：事件管线对带 condition 的注册要求 host.testTrigger 适配器，" +
    "已合入 host 都不提供；且条件里的 controller: \\\"controller\\\" 占位在参考内核与条件求值路径上都没有归一化" +
    "（参考内核按值比较，链的 query 只归一化 self/opponent），计数会落到 0 而让条件恒假——" +
    "在归一化落地前不能把该条件当作可执行。依赖：RIFT-82、RIFT-257/120。" +
    "draw 1 本体（effect.draw，414.3）已合入，golden 用解释器 + 参考内核真实执行该半段。",
  abilities,
  sourceText:
    "[Deathknell][>] If I didn't die alone, draw 1. (When I die, get the effect. I wasn't alone if there were other friendly units here.)"
} satisfies CardProgram;
