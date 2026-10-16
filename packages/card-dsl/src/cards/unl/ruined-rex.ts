import type { CardProgram } from "../../ir/index.js";

/**
 * Ruined Rex (unl-067-219) — Unit，6 能量 + 1 Power、Might 6，Mind / Bilgewater。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，unl-067-219，逐字）：
 *   [Deathknell][>] Deal 4 to an enemy unit. (When I die, get the effect.)
 *
 * 规则依据（CR v1.5）：
 * - 808.1 / 808.1.a：Deathknell 是触发式能力关键词（永久物上），按契约 3.1 用
 *   { kind: "keyword", keyword: "deathknell" } 声明，展开由关键词注册表负责。
 * - 808.1.c：Deathknell 功能上等同 "When I die, [Effect]."；808.1.d / 429.1.a.1.b
 *   说明自身死亡触发在送入 Trash 之前作为 Pending Item 入链，对应封闭时点
 *   object-killed。"[Effect]" 本体属于本卡，因此按已合入示例（watchful-sentry /
 *   undercover-agent）另写一条 object-killed 触发，指令体用已合入的 effect.damage。
 * - 355.9 / 355.10.b："an enemy unit" 是选目标（controller: opponent 是限制，
 *   355.9.a.1：未写地点时指 Board 上的单位）。数额为印刷常数 4，结算时求值（契约 3.6）。
 * - 418.6.a：未指定来源的 Deal 动作以描述该动作的能力为来源，effect.damage 缺省即
 *   ctx.source.ref，故不另写 source。
 *
 * status = judge-required（缺口不近似实现）：
 * - [Deathknell] 的展开不可执行：effects/keywords/Deathknell.ts 的触发体只引用
 *   trigger.leave，而 effects/instructions 没有该原语（registry.generated.ts 无 trigger.*
 *   条目）；808.1.d.1（死亡被替代时移出链）与 808.1.d.2/d.3（进链前记录 last-known）
 *   属触发/链管线。
 * - 没有任何模块把 CardProgram 的 triggered ability 注册成 TriggerRegistration
 *   （引擎批 4 / RIFT-120 事件管线），object-killed 订在真实内核里不可达。
 * 依赖：RIFT-82（kw-deathknell-legion）、RIFT-120（链/事件管线触发注册）。
 * "Deal 4 to an enemy unit" 本体只用已合入的 effect.damage，golden 已真实执行。
 */
const ruinedRex = {
  canonicalCardId: "card.hash-5fc071b35396434404e95d25b47aa739a9bb470b51d8c62aa840cf72ceea550b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Deathknell]（808.1）的展开不可执行：effects/keywords/Deathknell.ts 的触发体只引用未注册的 trigger.leave 原语" +
    "（effects/instructions/registry.generated.ts 无 trigger.* 条目），808.1.d.1（死亡被替代则移出链）与 808.1.d.2/d.3" +
    "（进链前记录 last-known）依赖触发/链管线；同时没有模块把 CardProgram 的 triggered ability 注册成 TriggerRegistration，" +
    "object-killed 订在真实内核里不可达（引擎批 4 / RIFT-120）。依赖：RIFT-82（kw-deathknell-legion）、RIFT-120。" +
    "「Deal 4 to an enemy unit」本体只用已合入的 effect.damage，已在 golden 中真实执行；整卡不因此标记 executable。",
  abilities: [
    { kind: "keyword", keyword: "deathknell" },
    {
      kind: "triggered",
      trigger: { at: "object-killed", filter: { event: "object-killed", filter: { role: "self" } } },
      optional: false,
      body: [
        {
          id: "ruined-rex.deal-4",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 4 },
            target: { kind: "constant", value: "ruined-rex.enemy-unit" }
          },
          targets: [
            {
              id: "ruined-rex.enemy-unit",
              filter: { type: "unit", zone: "board", controller: "opponent" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "[Deathknell][>] Deal 4 to an enemy unit. (When I die, get the effect.)"
} satisfies CardProgram;

export default ruinedRex;
