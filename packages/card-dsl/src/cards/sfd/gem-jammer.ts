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
 * status 判定（cards/README.md 第 2 节）：judge-required（2026-10-21 integration 复核）。
 * card-played 触发、场上单位目标、continuous.grant-keyword、end-of-turn 到期和
 * KeywordGrantLayerEngine 的动态重展开均可执行；真实 Standard Move 也能消费结算后
 * 的 battlefield-to-battlefield permission。剩余缺口是到期后的派生效果失效：
 * programs/statics.ts:184/194 把重展开 movement permission 注册为 permanent，且仅在
 * generated 内容变化时同步；turn-end 后 ability 层 Ganking 已过期，但 query 仍读到
 * 该 permanent permission，因此 movement() 仍返回 canGank。
 */
export default {
  canonicalCardId: "card.hash-f0ac9d90de705764ec57a50fb7483a35117949080af9f6a959eb42a7b887c9e9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "2026-10-21 integration 复核：本卡触发、敌方/己方单位目标、授予范围及真实战场间 Standard Move 已通过生产路径；" +
    "剩余阻塞在 programs/statics.ts:184/194：KeywordGrantLayerEngine 把 Ganking 重展开成 continuous.movement，" +
    "production setEffects 将该派生效果登记为 permanent；turn-end 后 ability 层 grant 与 raw keyword 都已过期，" +
    "但 lifecycleRuleEffects 仍保留 program-keyword:…ganking:effective… permission，production movement() 的 canGank " +
    "仍为 true（CR v1.5 810.1.b/810.1.c、144.4.c.1；到期/重查见 317.1.a、468.7.c、478.3/478.4）。" +
    "最小修法：派生 movement 的有效期必须与当前 granted keyword 绑定；到期或深过滤时删除/过滤该 generated effect，" +
    "并由真实 Standard Move 正反例断言该许可在 turn-end 后消失。",
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
