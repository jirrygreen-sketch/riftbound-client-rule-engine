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
 * status = judge-required：
 * 当前缺口是 Deathknell 正文绑定（CR 808.1.c/808.1.d）：effects/keywords/Deathknell.ts 展开体仍引用 trigger.leave，
 * 而 instructions 注册表没有该 op；programs/keywords.ts 也未把本卡的伤害正文接入该骨架。
 * 展开过滤器中的 cause / destination 未被 programs/filters.ts 保留，仍需保证死亡送入 Trash 的过滤语义。
 */
const ruinedRex = {
  canonicalCardId: "card.hash-5fc071b35396434404e95d25b47aa739a9bb470b51d8c62aa840cf72ceea550b",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口是 Deathknell 正文绑定（CR 808.1.c/808.1.d）：effects/keywords/Deathknell.ts 展开体仍引用 trigger.leave，" +
    "而 instructions 注册表没有该 op；programs/keywords.ts 也未把本卡的伤害正文接入该骨架。" +
    "展开过滤器中的 cause / destination 未被 programs/filters.ts 保留，仍需保证死亡送入 Trash 的过滤语义。",
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
