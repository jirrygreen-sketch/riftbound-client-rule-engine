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
 * status = judge-required（2026-10-17 按当前合入源码复核，缺口实测，不近似实现）：
 * 1. [Deathknell] 的 KeywordDef 已注册，但其展开体仍引用未注册的 trigger.leave 指令：
 *    解释器对该指令体实测抛 "Unregistered instruction opcode: trigger.leave"，
 *    808.1.d.1（死亡被替代则移出链）与 808.1.d.2/.d.3（进链前记录 last-known）仍缺离场处理。
 * 2. 本卡自己的 object-killed 触发已能注册并带上 condition（实测
 *    registerProgramTriggers 返回两个 id 且第一个注册项含该 compare 条件），
 *    但条件里的 controller: "controller" 占位没有被归一化：参考内核与事件管线的
 *    evaluateTriggerCondition 都用字面值比较，集合查询落到 0 条，因此即使同位置确实有
 *    其他友方单位，条件也实测为 false；把该占位换成字面玩家 id 才求值为 true。
 *    808.1.d.3 要求用来源的 last-known 位置求值，这依赖同一个归一化路径。
 * 依赖：Deathknell 的 trigger.leave 离场指令，以及进链前条件求值的 controller 归一化。
 * draw 1 本体（effect.draw，414.3）已合入，golden 用解释器 + 参考内核真实执行该半段。
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
    "两处当前缺口（2026-10-17 实测，均不近似实现）：" +
    "(1) [Deathknell]（808.1）的 KeywordDef 展开体仍引用未注册的 trigger.leave 指令" +
    "（effects/instructions/registry.generated.ts 只有 42 个 op，无 trigger.* 条目）：解释器对该展开体实测抛 " +
    "\"Unregistered instruction opcode: trigger.leave\"；808.1.d.1 的离场处理与 808.1.d.2/.d.3 的 last-known 记录仍缺。" +
    "(2) “If I didn't die alone”（808.1.c.2 的过去式；740.2.a 的 alone 之否定）已经作为触发条件注册成功" +
    "（实测 registerProgramTriggers 返回两个 id，其中一个注册项带该 compare 条件），但条件里的 " +
    "controller: \"controller\" 占位没有被归一化：参考内核与事件管线的 evaluateTriggerCondition 都按值比较，" +
    "集合查询落到 0 条，因此同位置确实有其他友方单位时条件实测仍为 false（把占位换成字面玩家 id 才为 true）；" +
    "808.1.d.3 的 last-known 位置求值依赖同一归一化路径。" +
    "draw 1 本体（effect.draw，414.3）已合入，golden 用解释器 + 参考内核真实执行该半段。",
  abilities,
  sourceText:
    "[Deathknell][>] If I didn't die alone, draw 1. (When I die, get the effect. I wasn't alone if there were other friendly units here.)"
} satisfies CardProgram;
