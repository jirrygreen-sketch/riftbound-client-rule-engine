import type { CardProgram } from "../../ir/index.js";

/**
 * Resource Extractor (rad-052-167) — Gear, 1 Energy, no Power, tag Device.
 *
 * Printed text (deck-catalog.json, rad-052-167, verbatim):
 *   [Deploy] (Play this only to a battlefield. When an opponent holds here, kill
 *   this.)
 *   At the end of your turn, if you control this battlefield, play a Gold gear
 *   token exhausted. (It has "[Reaction][>] Kill this, :rb_exhaust:: [Add]
 *   :rb_rune_rainbow:.")
 *
 * Rules evidence (Core Rules v1.5):
 * - 830.1 / 830.1.a / 830.1.b: Deploy is a Passive and Triggered Ability keyword
 *   on Gear (only to a battlefield, not recalled in cleanups, killed when an
 *   opponent holds there). Declared here; expansion belongs to the keyword
 *   registry (contract 3.7).
 * - 317.1.a: "At the end of this turn and at the end of turn Game Effects take
 *   place" — the ending step, which the closed timing point `turn-end`
 *   (events/timing-points.ts, ref 317.1.a) names. "your turn" scopes it to the
 *   ability controller's turn (190.6.d / 304).
 * - 364.3 / 364.3.a: "if you control this battlefield" is a conditional clause
 *   on a Passive/Triggered ability. 190.2.b / 190.1: Battlefield control is a
 *   binary player state, and 053.3 makes "this battlefield" the source Gear's
 *   location. This is a condition, not a target choice (355.10.c lists trigger
 *   conditions among the non-target exceptions).
 * - 187.5: a Gold gear token is a domainless gear token whose own ability is
 *   "[Reaction][>] Kill this, [E]: [Add] [A]." The printed reminder quotes
 *   exactly that definition, so the card authors no token statistics of its own.
 * - 350.2 / 440.2.c / 185.2.a: "play ... token" means the token is created on
 *   the Chain and the chain's play flow takes it over. 143.4 / 185.2.d: the
 *   printed "exhausted" is an entry-state override on that play.
 * - 135.2.d.3: the parenthetical is reminder text; it describes the Gold token's
 *   own ability rather than adding one to this card.
 *
 * Status: judge-required (rechecked 2026-10-17). Current gaps, none approximated:
 * - The Deploy KeywordDef is merged (RIFT-267), but its 830.1.b rewrites still
 *   have no consumers: Finalize does not read continuous.location, cleanup does
 *   not apply the non-Unit "not recalled" exemption, and the opponent-Hold kill
 *   trigger is never registered into the event pipeline (RIFT-120).
 * - The Gold token is deliberately absent from effect.token's DEFINITIONS table:
 *   definitions carrying their own abilities (Gold, 187.5) are documented there
 *   as blocked / judge-required, and the primitive returns negated with
 *   blockedReason "token-definition-or-abilities-judge-required". Nothing here
 *   invents a plain gear token in its place.
 * - The "exhausted" entry override has no primitive path: effect.token's docs
 *   state "Entry overrides are not supported" (143.4 / 185.2.d), so playing it
 *   ready would misreport the board, and a later effect.exhaust would be a
 *   separate exhaust action rather than the printed entry state.
 * - The trigger has no registration path (no CardProgram -> TriggerRegistration
 *   adapter, RIFT-120), the "turn-end" event is absent from the engine's
 *   EVENT_PATTERN_TYPES (validateTriggerSpec reports invalid-event-type even
 *   though the timing point exists), and the "you control this battlefield" condition has no
 *   evaluated predicate: the IR Condition kinds (always / never / compare / all /
 *   any / not / expression) carry no battlefield-control query. The condition is
 *   recorded as the pending predicate shape.
 * Dependencies: RIFT-120 (Deploy consumers + trigger registration), the token
 * definition table (187.5 / RIFT-9), and the entry-state override.
 */
const resourceExtractor = {
  canonicalCardId: "card.hash-15ed917fed0055c9ae8325c668e501db603af32e4ff58c00dca6ad354739ac93",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口（2026-10-17 复核，均不近似实现）：(1) Deploy 的 KeywordDef 已合入（RIFT-267），但 " +
    "830.1.b 的改写仍无消费方：Finalize 不读 continuous.location 的打出位置许可、Cleanup 不应用" +
    "非单位 Gear 不召回的豁免、hold 触发消灭也没有注册进事件管线（RIFT-120）。" +
    "(2) Gold gear token 定义（CR 187.5，带自身 " +
    '"[Reaction][>] Kill this, [E]: [Add] [A]"' +
    " 能力）不在 effect.token 的 DEFINITIONS 表：该原语对带能力的 token 保持 blocked/judge-required，" +
    "实测返回 negated 且 blockedReason = token-definition-or-abilities-judge-required。" +
    "(3) exhausted 入场覆盖：effect.token 文档明确不支持 entry overrides（143.4 / 185.2.d），" +
    '"play ... token exhausted" 与 ready 的差别没有原语路径（先入场再 effect.exhaust 会多出一次横置动作，不是入场状态）。' +
    "(4) 触发没有注册路径（缺 CardProgram → TriggerRegistration 适配器，RIFT-120），" +
    "且「if you control this battlefield」没有可求值谓词（Condition 的 always/never/compare/all/any/not/expression " +
    "都不查询战场控制状态；此外 turn-end 事件不在引擎 EVENT_PATTERN_TYPES 词表内" +
    "（validateTriggerSpec 实测 invalid-event-type，时点本身存在）；程序只保留待接线条件形状。" +
    "依赖：RIFT-120、token 定义表（187.5 / RIFT-9）、入场状态覆盖、turn-end 事件词表" +
    "（无已分配任务号）、战场控制谓词（进行中：RIFT-359 条件谓词）。",
  abilities: [
    // 830.1：印刷的 [Deploy] 声明（展开依赖 kw-deploy）。
    { kind: "keyword", keyword: "deploy" },
    {
      // 317.1.a："At the end of your turn" → turn-end（能力控制者的回合）。
      kind: "triggered",
      trigger: {
        at: "turn-end",
        // "your turn"：190.6.d / 304，能力控制者的回合；"this battlefield"
        // （053.3）的控制条件作为待接线谓词记录在 condition 上。
        filter: { event: "turn-end", player: "self" },
        condition: {
          kind: "expression",
          // 190.1 / 190.2.b："you control this battlefield"。Condition 的既有
          // 种类无法查询战场控制状态，这里记录待接线谓词（见 judgeReason 第 4 点）。
          value: {
            kind: "constant",
            value: "controller-controls-source-battlefield"
          }
        }
      },
      optional: false,
      body: [
        {
          // 440.2.c / 185.2.a / 187.5：链上生成 Gold gear token 再交由 play 接手。
          // Gold 定义缺失与 exhausted 入场覆盖都使该指令 fail-closed（见 judgeReason）。
          id: "resource-extractor.play-gold-token",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "gold" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            // 目的地是来源战场（this battlefield，053.3）：token 在该战场生成，
            // 目的地由来源快照的 location 提供。
            target: { kind: "constant", value: "resource-extractor.self-battlefield" },
            linkKey: { kind: "constant", value: "goldToken" }
          },
          targets: [
            {
              id: "resource-extractor.self-battlefield",
              // 来源自身（符号选择器 self），其 Location 即 this battlefield。
              filter: { source: "self" },
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
    "At the end of your turn, if you control this battlefield, play a Gold gear token exhausted. " +
    "(It has \"[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.\")"
} satisfies CardProgram;

export default resourceExtractor;
