import type { CardProgram } from "../../ir/index.js";

/**
 * Blossoming Dreamroot (rad-024-167) — Gear, 2 Energy, no Power, tag Device.
 *
 * Printed text (deck-catalog.json, rad-024-167, verbatim):
 *   [Deploy] (Play this only to a battlefield. When an opponent holds here, kill
 *   this.)
 *   When you win a combat here, draw 1.
 *
 * Rules evidence (Core Rules v1.5):
 * - 830.1 / 830.1.a / 830.1.b: Deploy is a Passive and Triggered Ability
 *   keyword present on Gear (only to a battlefield, not recalled in cleanups,
 *   killed when an opponent holds there). Declared here; the expansion belongs
 *   to the keyword registry (contract 3.7).
 * - 468.3 / 468.3.a: winning a combat is determined in Step 3 of combat (the
 *   Resolution Step) — a player has won when they held the attacker or defender
 *   designation and are the only player with units remaining at that
 *   Battlefield. The closed timing point for it is combat-result
 *   (events/timing-points.ts: payloadType combat-result, payloadFields
 *   battlefieldId/winnerId/loserId; refs 468.3.a-468.3.d). 468.3.d's No Result
 *   case is not a win.
 * - 053.3 / 190.6.d: here is the source Gear's Battlefield, and you in a
 *   permanent's abilities is its controller.
 * - 414.3: draw 1 is a single effect.draw, whose implicit drawer is the
 *   ability's controller (190.6.d).
 *
 * Status: judge-required. The draw body itself is merged and executable, but the
 * trigger cannot be honestly declared or run:
 * 1. here needs the source-Battlefield identity in the trigger filter. The
 *    merged EventPattern/ObjectFilter vocabulary has no location anchor
 *    (events/trigger-spec.ts validates an allow-list without `here` or
 *    `sameLocationAs`; the engine's assertTriggerSpec rejects both), so the
 *    printed restriction is carried as the sibling battlefield placeholder
 *    here: true (053.3).
 * 2. No merged module emits combat-result into the single event pipeline:
 *    chain/engine.ts emits only chain-item-*, cleanup-*, showdown-*,
 *    card-played and became-target, and combat/ is not bridged to it (contract
 *    section 7.2 batch 5, RIFT-33). The trigger could not be placed on the
 *    chain regardless of its filter.
 * 3. There is no CardProgram -> TriggerRegistration adapter, so the ability is
 *    not registered at all (RIFT-120 follow-up).
 * The structure below keeps the printed trigger, its timing point and the draw
 * body for review; the golden test validates the data and executes the draw
 * instruction in isolation. Not approximated: the win condition is not widened
 * to a plain combat end or an unconditional draw.
 */
const blossomingDreamroot = {
  canonicalCardId: "card.hash-4aaea9c834beaa6047e8f8dbb7f92137da63c691f1458dc1769641fd1ac8f358",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1)「here」需要来源战场身份进入触发 filter，" +
    "但已合入的 EventPattern/ObjectFilter 词汇没有位置锚点（events/trigger-spec.ts 的允许字段白名单不含 " +
    "here/sameLocationAs，引擎侧 assertTriggerSpec 同样拒绝），程序按同类战场卡保留 here: true 占位（053.3）。" +
    "(2) 没有任何已合入模块把 combat-result 时点（CR 468.3/468.3.a，时点定义见 events/timing-points.ts）" +
    "emit 进唯一事件管线：chain/engine.ts 只产生 chain-item-*/cleanup-*/showdown-*/card-played/became-target，" +
    "combat/ 未接线（契约 §7.2 批 5、RIFT-33）。(3) 缺 CardProgram → TriggerRegistration 适配器，" +
    "触发能力根本没有注册路径（RIFT-120 后续）。draw 1（414.3）本身已合入并由 golden 单独执行；" +
    "不把 win a combat 放宽为战斗结束或无条件抽牌。",
  abilities: [
    // 830.1：印刷的 [Deploy] 声明（展开依赖 kw-deploy，见 judgeReason）。
    { kind: "keyword", keyword: "deploy" },
    {
      kind: "triggered",
      trigger: {
        at: "combat-result",
        // win a combat here：here 是来源战场锚点占位（见 judgeReason 第 1 点）；
        // you 是能力控制者（190.6.d）。
        filter: { event: "combat-result", here: true, player: "self" }
      },
      optional: false,
      body: [
        {
          id: "blossoming-dreamroot.draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText:
    "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
    "When you win a combat here, draw 1."
} satisfies CardProgram;

export default blossomingDreamroot;
