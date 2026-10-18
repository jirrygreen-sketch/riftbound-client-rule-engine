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
 * status 判定（cards/README.md 第 2 节）：judge-required。合入的
 * KeywordGrantLayerEngine 已能把运行时 Ganking 重新展开为 movement permission，
 * movement()/canGank 也能读取该路由；但 production lifecycle 仍创建普通 LayerEngine，
 * 不会在 card-played 结算后重建关键词展开，因此标准移动路径尚不能消费这张卡授予的许可。
 * 已合入并真实执行：continuous.grant-keyword、Ganking KeywordDef 与触发注册；golden
 * 经真实 ChainEngine 管线解析本卡的 card-played 触发，
 * 断言授予只落在被选单位、duration 到期后消失（不构成整卡证据）。
 */
export default {
  canonicalCardId: "card.hash-f0ac9d90de705764ec57a50fb7483a35117949080af9f6a959eb42a7b887c9e9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口是 production lifecycle 的动态重展开接线：运行时获得的 Ganking 已可由合入的 KeywordGrantLayerEngine" +
    "消费成 810.1.b/810.1.c 的 movement permission，layers/rules/query 的 movement()/canGank 也能读取" +
    "battlefield-to-battlefield route；但 production lifecycle 仍使用普通 LayerEngine，card-played 结算后的授予" +
    "不会进入该 re-expander，标准移动合法性检查因此还不能消费这张卡的许可。" +
    "continuous.grant-keyword、Ganking KeywordDef 与 card-played 触发注册本身已可执行；" +
    "golden 经真实 ChainEngine 管线执行本卡 card-played 触发并断言授予范围与 end-of-turn 到期，不近似实现。",
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
