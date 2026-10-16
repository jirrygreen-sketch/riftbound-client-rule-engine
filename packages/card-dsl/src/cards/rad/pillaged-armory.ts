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
 * status：judge-required。两个缺口：
 * 1. Deploy 没有已合入的 KeywordDef（effects/keywords/ 不含 Deploy），830.1.b 的
 *    入场地点 / 召回 / 对手固守时消灭三项改写都未展开（kw-deploy 指向的
 *    continuous.location / continuous.restrict 尚无消费方）。
 * 2. 两条触发都没有可执行接线：没有卡牌程序 → TriggerRegistration 的适配器，
 *    "conquer here" 的 here 过滤也依赖征服时点携带战场身份（契约 3.5 / RIFT-120 后续）。
 * effect.buff 本体（含已有 Buff 不再放置）已合入并由 golden 真实执行；不据此宣称整卡可执行。
 */
export default {
  canonicalCardId: "card.hash-c3300d4c2699318874a04e6169dc566f6c3e88300d3f2ccd920a1edf3352d84a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1) Deploy 关键词没有 KeywordDef（CR 830.1.b：入场地点许可、非单位 Gear 不被清理召回、" +
    "对手在此固守时消灭此牌都需要展开；调研表 kw-deploy 指向的 continuous.location/" +
    "continuous.restrict 没有消费方）。(2) 两条触发能力没有可执行接线：缺少卡牌程序→" +
    "TriggerRegistration 的适配器（RIFT-120 后续 / 协调任务），" +
    "\"when you conquer here\" 的 here 过滤还需要征服时点携带战场身份（契约 3.5）。" +
    "effect.buff 本身已合入并单独执行（含 702.3.a 的已有 Buff 不再放置）；不近似实现。",
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
