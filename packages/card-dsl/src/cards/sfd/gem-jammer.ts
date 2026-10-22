import type { CardProgram } from "../../ir/index.js";

/**
 * Gem Jammer (sfd-007-221) — Rumble SFD precon unit.
 *
 * When you play me, give a unit [Ganking] this turn.
 * (It can move from battlefield to battlefield.)
 *
 * 规则依据（CR v1.5）：
 * - "When you play me" 是 Play Effect（383.4.a / 420.4.a），订阅 card-played 时点、
 *   filter 以 role/source: "self" 指称本卡；生产触发注册会把 role: "self"
 *   映射为 objectId 锚点。
 * - "give a unit [Ganking] this turn" 是带 end-of-turn 期限的关键词授予（810）：
 *   merged continuous.grant-keyword 指令注册 ability 层效果，duration
 *   "this-turn"/"end-of-turn" 映射到 turn-end 到期。
 *
 * status 判定（cards/README.md 第 2 节）：executable（2026-10-22 integration 复核）。
 * card-played 触发、场上单位目标、continuous.grant-keyword、KeywordGrantLayerEngine
 * 的动态重展开及真实 Standard Move 均在生产路径执行。turn-end Ending Step 中许可
 * 仍有效；Expiration Step 的 TurnPhaseLayers.expireTurn() 会同步撤销 Ganking 与派生
 * movement permission（317.1.a / 317.2.c），之后战场间 Standard Move 被拒绝。
 */
export default {
  canonicalCardId: "card.hash-f0ac9d90de705764ec57a50fb7483a35117949080af9f6a959eb42a7b887c9e9",
  rulesetVersion: "core-1.5",
  status: "executable",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { role: "self" } }
      },
      optional: false,
      body: [
        {
          id: "gem-jammer.grant-ganking",
          op: "continuous.grant-keyword",
          args: {
            keyword: { kind: "constant", value: "Ganking" },
            duration: { kind: "constant", value: "end-of-turn" },
            // 契约 3.6：作用对象经 objects 描述符指向 Finalize 锁定的 TargetSpec；
            // 缺省选择是来源自身，不是本卡的 "a unit"。
            objects: {
              kind: "constant",
              value: { kind: "target", id: "gem-jammer.unit" }
            }
          },
          targets: [
            {
              id: "gem-jammer.unit",
              filter: { zone: "board", type: "unit" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "When you play me, give a unit [Ganking] this turn. (It can move from battlefield to battlefield.)"
} satisfies CardProgram;
