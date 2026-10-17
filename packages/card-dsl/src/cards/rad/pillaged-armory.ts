import type { CardProgram } from "../../ir/index.js";

/**
 * Pillaged Armory (rad-073-167) — Gear, 1 energy、power null，Calm，tags [Device]。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json rad-073-167）：
 *   "[Deploy] (Play this only to a battlefield. When an opponent holds here,
 *    kill this.)
 *    When you play this or when you conquer here, [Buff] a friendly unit.
 *    (Give it a +1 :rb_might: buff if it doesn't have one.)"
 *
 * 规则依据（CR v1.5）：
 * - 830 / 830.1.b：印刷的 [Deploy]（关键词声明，展开缺口见 judgeReason）。
 * - 383.4.a / 383.4.a.1："When you play this" 是 Gear 的 Play Effect，对应时点
 *   card-played，filter 指向自身，"you" 为触发控制者。
 * - 383.4.c / 383.4.c.1："when you conquer here" 是 Conquer Effect，对应时点 conquer
 *   （此战场）；"you" 指该触发控制者（190.6.d）。
 * - 427.1 / 427.1.b / 702.3.a："[Buff] a friendly unit" 是 Buff 游戏动作（不是关键词，
 *   也不是 Might 修改）：给一个你控制的单位放置一个 Buff counter；已有 Buff 的单位
 *   不再放置（702.3.a）。用已合入的 effect.buff，目标为一个友方 Board 单位。
 *
 * status：judge-required（2026-10-17 复核后更新）。具体缺口：
 * 1. Deploy 的 KeywordDef（RIFT-267 的 effects/keywords/Deploy.ts）已合入，但它的
 *    continuous.location 静态声明绑不进图层：programs/statics.ts 的 layerFor 抛
 *    “Static ability kind continuous.location has no layer mapping”。Finalize 的
 *    合法打出位置校验（chain/engine.ts 的 playDestinationIsLegal）只读限制名、不消费
 *    any-battlefield 一类许可；Cleanup 的“非单位 Gear 不召回”分支（830.1.b.3）在
 *    turn/flow.ts 里仍统一按 recall-action 抛 blocked；830.1.b 的“对手在此固守时消灭”
 *    注册也因 hold 过滤（830.3 的 here 谓词）被拒而未接线。
 * 2. TriggerRegistration 生产适配器已合入（programs/triggers.ts）："When you play this"
 *    编译成 {event:\"card-played\", object:{objectId}, player:\"self\"} 并对真实 card-played
 *    事件判定为 true（golden 有执行证据）。但 "when you conquer here" 的 here 过滤仍被
 *    programs/filters.ts 拒绝（实测 “Unsupported filter field here”），conquer 载荷虽带
 *    details.battlefieldId（turn/flow.ts），触发系统没有把该战场身份与来源绑定的谓词。
 * effect.buff 本体（含已有 Buff 不再放置）已合入并由 golden 真实执行；
 * Deploy 的 kill body 也在引擎既有测试里执行，但整卡仍需上述接线。
 */
export default {
  canonicalCardId: "card.hash-c3300d4c2699318874a04e6169dc566f6c3e88300d3f2ccd920a1edf3352d84a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) Deploy 的展开（RIFT-267，effects/keywords/Deploy.ts：continuous.location 的" +
    "830.1.b 地点许可/仅可打到战场/非单位 Gear 不召回 + hold 触发消灭）已合入但消费方未接线：" +
    "static 绑定抛 “Static ability kind continuous.location has no layer mapping”（programs/statics.ts 的 layerFor）；" +
    "Finalize 的 playDestinationIsLegal 只读限制名、不消费 any-battlefield 一类许可；" +
    "Cleanup 对非单位 Gear 仍统一按 recall-action 抛 blocked（turn/flow.ts，830.1.b.3 未落地）；" +
    "hold 触发的 here 过滤被 programs/filters.ts 拒绝。" +
    "(2) TriggerRegistration 生产适配器已合入（programs/triggers.ts），\"When you play this\" 能编译成 " +
    "{event:\"card-played\", object:{objectId}, player:\"self\"} 并匹配真实 card-played 事件（golden 有执行证据）；" +
    "但 \"when you conquer here\" 的 here 过滤仍抛 “Unsupported filter field here”，" +
    "conquer 载荷虽带 details.battlefieldId（turn/flow.ts），触发系统没有把该战场身份与来源绑定的谓词。" +
    "effect.buff 本体（含 702.3.a 的已有 Buff 不再放置）已合入并由 golden 真实执行；" +
    "不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "deploy" },
    {
      // 383.4.a.1："When you play this" → card-played（自身打出）。
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { source: "self", player: "self" } }
      },
      optional: false,
      body: [
        {
          id: "pillaged-armory.buff-on-play",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "friendly-unit-on-play" }
          },
          targets: [
            {
              id: "friendly-unit-on-play",
              filter: { type: "unit", controller: "self", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    },
    {
      // 383.4.c.1："when you conquer here" → conquer（此战场、由你征服）。
      kind: "triggered",
      trigger: {
        at: "conquer",
        filter: { event: "conquer", here: true, player: "self" }
      },
      optional: false,
      body: [
        {
          id: "pillaged-armory.buff-on-conquer",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "friendly-unit-on-conquer" }
          },
          targets: [
            {
              id: "friendly-unit-on-conquer",
              filter: { type: "unit", controller: "self", zone: "board" },
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
    "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
    "When you play this or when you conquer here, [Buff] a friendly unit. " +
    "(Give it a +1 :rb_might: buff if it doesn't have one.)"
} satisfies CardProgram;
