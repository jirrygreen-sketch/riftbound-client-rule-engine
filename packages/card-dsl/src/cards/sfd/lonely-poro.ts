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
 * status 判定（cards/README.md 第 2 节）：judge-required（复核 2026-10-16）。
 * - 已合入：RIFT-258/259 的 registration 后，RIFT-257 的 triggerRegistrations 能把本卡
 *   显式 triggered ability 翻译并安装（golden 证明安装成功）；effect.draw 本体真实执行。
 * - 仍缺（两处已实证的缺口）：
 *   1. [Deathknell] 的展开体引用 trigger.leave，而该 op 没有已合入的 InstructionDef
 *      （effects/instructions/registry.generated.ts 无 trigger.* 条目）；一旦该展开的
 *      触发结算就会抛 Unregistered instruction opcode。
 *   2. 生产触发生命周期（programs/lifecycle.ts 的 attachProgramLifecycle）在
 *      object-leaves-board 事件后即 unregister 该卡的注册，而 kill 动作的
 *      object-killed 事件在 leaves-board 之后才扫描——死亡触发在送达前已被移除
 *      （golden 在真实链上复现：注册存在、kill 后无触发进链）。808.1.d.1
 *      （死亡被替代则移出链）与 808.1.d.2/.d.3（进链前记录 last-known）也依赖该管线。
 * - 「died alone」的条件（740.2.a）另需触发进链前的条件求值：条件用
 *   sameLocationAs/exclude 锚点与 controller 占位符，参考内核的 test() 不解释锚点、
 *   也不归一化 "controller"（计数落到 0 → 条件恒真），生产 host 必须提供等价的
 *   条件适配器与 last-known 位置。
 * 依赖：Deathknell 展开体的 trigger.leave 原语、死亡触发的生命周期送达、进链前条件求值。
 * draw 1 本体只用已合入的 effect.draw。不近似实现。
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
    "两处已实证的缺口：(1) [Deathknell]（808.1）的展开体引用 trigger.leave，而该 op 没有已合入的 InstructionDef" +
    "（effects/instructions/registry.generated.ts 无 trigger.* 条目），展开的触发一旦结算就抛 Unregistered instruction opcode；" +
    "(2) 生产触发生命周期（programs/lifecycle.ts attachProgramLifecycle）在 object-leaves-board 事件后即取消注册，" +
    "而 kill 的 object-killed 事件在 leaves-board 之后扫描——死亡触发在送达前被移除（真实链上复现：注册成功、kill 后触发不进链）；" +
    "808.1.d.1（死亡被替代则移出链）与 808.1.d.2/.d.3（进链前记录 last-known）同属该管线。" +
    "「If I died alone」的条件（CR 740.2.a；808.1.c.2 的过去式指进链那一刻）还需要进链前的条件求值：" +
    "sameLocationAs/exclude 锚点与 controller 占位符在参考内核的 test() 里不解释/不归一化（计数落到 0、条件恒真），" +
    "生产 host 必须提供等价的条件适配器与来源的 last-known 位置。RIFT-257 的注册对显式 triggered ability 已可安装（golden 证明）。" +
    "依赖：Deathknell 展开体的 trigger.leave、死亡触发生命周期送达、进链前条件求值。" +
    "draw 1 本体只用已合入的 effect.draw。不近似实现（不把「died alone」写成无条件抽牌，也不用近似谓词）。",
  abilities,
  sourceText:
    "[Deathknell] — If I died alone, draw 1. (When I die, get the effect. I'm alone if there are no other friendly units here.)"
} satisfies CardProgram;

export default program;
