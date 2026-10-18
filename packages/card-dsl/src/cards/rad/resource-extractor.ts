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
 * 2026-10-18 再复核：整卡仍为 judge-required；当前缺口见 judgeReason。
 * 已合入原语与关键词声明不等于生产链路可执行；局部执行证据见同名单卡测试。
 * 本轮去掉一条已经不成立的缺口：turn/flow.ts 的 cleanup 已按关键词 "deploy"
 * 豁免非 Unit Gear 的 Recall（830.1.b.3），实测把带 Deploy 的装备留在战场、
 * 不带该关键词的装备仍抛 recall-action。
 */
const resourceExtractor = {
  canonicalCardId: "card.hash-15ed917fed0055c9ae8325c668e501db603af32e4ff58c00dca6ad354739ac93",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四项当前真实缺口（2026-10-18 实测）：" +
    "(1) [Deploy]（830.1）的展开仍缺消费者：static continuous.location 在 programs/statics.ts 的 layerFor " +
    "报 “Static ability kind continuous.location has no layer mapping”，hold 触发的 filter { here: true } " +
    "被 programs/filters.ts 判 “Unsupported filter field here”。清洁期的非 Unit Deploy 装备豁免已合入" +
    "（turn/flow.ts 按关键词 \"deploy\" 跳过 Recall；实测带 Deploy 的装备留在战场、不带则该步抛 recall-action），" +
    "所以 830.1.b.3 不再是缺口。" +
    "(2) Gold gear token（187.5，带自身 \"[Reaction][>] Kill this, [E]: [Add] [A]\"）不在 effect.token 的冻结定义表：" +
    "执行本卡自己的 token 指令返回 negated(impossible, token-definition-or-abilities-judge-required)，amount 0、objects 空；" +
    "不能用无能力装备近似，TokenSpec 也没有承载 token 自带能力的字段。" +
    "(3) 印刷的 exhausted 入场状态（143.4、185.2.d）无入口：effect.token 的 argsSchema 拒绝 entersExhausted，" +
    "创建后再 effect.exhaust 是另一个动作，不能代替入场状态。" +
    "(4) 触发链的两处仍断：「At the end of your turn」的 turn-end 不在封闭的 EVENT_PATTERN_TYPES，" +
    "validateTriggerSpec 返回 invalid-event-type，生产 TriggerRegistration 因此无法注册本卡触发；" +
    "「if you control this battlefield」（364.3）没有可查询的战场控制状态——condition.result 与事件印刷值谓词" +
    "虽已合入，但没有读取战场控制状态的谓词，当前 condition 只是占位常量字符串，按布尔表达式求值恒真，不是有效谓词。" +
    "已可执行的部分：Deploy 目的地/控制器基地计算（359.2.d 的 ability-controller-base，condition.value 链接给 effect.token，" +
    "按能力控制者解出 { type: \"base\", player }）与 effect.token 的失败回执路径；这些都不等于 Gold 已能生成或横置入场。",
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
          // 359.2.d：条件中的「this battlefield」不指定普通 Gear 的入场位置。
          // effect.token 的 schema 尚不接受 location Expr，先求值再链接真实基地。
          id: "resource-extractor.controller-base",
          op: "condition.value",
          args: {
            value: { kind: "location", value: "ability-controller-base" }
          }
        },
        {
          // 440.2.c / 185.2.a / 187.5：链上生成 Gold gear token 再交由 play 接手。
          // Gold 定义缺失与 exhausted 入场覆盖都使该指令 fail-closed（见 judgeReason）。
          id: "resource-extractor.play-gold-token",
          op: "effect.token",
          args: {
            token: { kind: "constant", value: "gold" },
            amount: { kind: "constant", value: 1 },
            mode: { kind: "constant", value: "play" },
            location: {
              kind: "linked-value",
              instructionId: "resource-extractor.controller-base",
              key: "value"
            },
            linkKey: { kind: "constant", value: "goldToken" }
          }
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
