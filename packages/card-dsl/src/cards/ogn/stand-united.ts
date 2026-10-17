import type { CardProgram } from "../../ir/index.js";

/**
 * Stand United (ogn-053-298) — Spell, 3 energy (Calm).
 *
 * Printed text:
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)
 *   [Action] (Play on your turn or in showdowns.)
 *   Buff a friendly unit. Buffs give an additional +1 :rb_might: to friendly
 *   units this turn. (To buff a unit, give it a +1 :rb_might: buff if it
 *   doesn't already have one.)
 *
 * Modeling notes (Core Rules v1.5):
 * - [Hidden] (811) and [Action] (806) are keyword abilities expanded by the
 *   keyword registry (contract 3.7). Hidden's expansion (cost.hidden) and the
 *   facedown permission remain the Hidden workstream's job (811.1.c.2's
 *   cost-0 play from the facedown zone); the card only names the keyword.
 * - "Buff a friendly unit. (To buff a unit, give it a +1 :rb_might: buff if it
 *   doesn't already have one.)" is the merged effect.buff primitive in "buff"
 *   mode (427.1.b / 427.1.b.1 / 702.2.a: place one Buff counter if the unit
 *   does not already have one). "a friendly unit" is a target (355.7 /
 *   355.9.b). The golden test executes this half through the real primitive.
 *
 * Status: judge-required — the second sentence's Might modifier is now
 * expressible and executable in isolation:
 * "Buffs give an additional +1 :rb_might: to friendly units this turn" changes
 * what a Buff contributes for the rest of the turn (CR 703 states the printed
 * baseline: each Buff individually contributes +1 Might). That is a
 * duration-bounded Might modifier applied to every friendly unit that has a
 * Buff (811.2's Stand United example confirms the second part affects all
 * friendly units with buffs regardless of location, unlike the first part).
 * The merged continuous.might instruction (RIFT-258) registers a matching
 * arithmetic-layer effect with an end-of-turn duration, and the Buff count is
 * readable through ObjectFilter.characteristics ({ buffs: 1 }); the golden
 * test executes both instructions through the interpreter and layer engine.
 * The card stays judge-required for three reasons:
 * 1. the instruction resolves its selection once and registers one effect per
 *    resolved object; that snapshot cannot express the printed class rule:
 *    a friendly unit that gains its first Buff later in the turn does not
 *    receive the +1, and a unit whose Buff is spent keeps it (the card text
 *    is a rule-modifying continuous effect over "buffs" as a class, not a set
 *    of objects fixed at resolution);
 * 2. [Hidden]'s Hide action and facedown play still lack the cost.hidden path
 *    (811.1.b/811.1.c.2); the hidden expansion itself is merged (RIFT-84) but
 *    its cost/zone consumption is not.
 * Not approximated by buffing extra units or by granting a second Buff counter
 * (702.3 / 427.1.b.1 forbid more than one Buff, and a Buff counter is not a
 * Might modification).
 */
const standUnited = {
  canonicalCardId: "card.hash-40071acacac7084766aaea4ce4329db5541d659f9ec5225d9dc853542a456664",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "“Buffs give an additional +1 Might to friendly units this turn”的 Might 修正已可执行：CR 703 是 Buff 的印刷基线" +
    "（每个 Buff 贡献 +1 Might），本句在整回合内改写该贡献，属于带 end-of-turn 期限、作用于“拥有 Buff 的友方单位”" +
    "（811.2 的 Stand United 示例明确该部分不受所在地点限制）的 continuous.might 持续效果；" +
    "continuous.might 指令（RIFT-258）已合入并注册 end-of-turn 效果，Buff 计数经 ObjectFilter.characteristics 可读。" +
    "整卡仍不可执行：(1) 该指令在结算时一次性解析选择并逐对象注册效果，这份固定快照无法表达卡面的类别规则——" +
    "本回合稍后才获得第一个 Buff 的友方单位不会因此 +1，Buff 被消耗掉的单位也不会收回该 +1" +
    "（卡面是以「Buff」为一类对象的规则修改型持续效果，不是结算时固定的一份对象集合）；(2) [Hidden] 的 Hide 行动与背面打出也没有 cost.hidden 消费路径（811.1.b/811.1.c.2）。" +
    "不近似实现：不能多发一个 Buff（702.3/427.1.b.1 禁止第二个 Buff，且 Buff 计数不是 Might 修改）。" +
    "“Buff a friendly unit”（427.1.b / effect.buff）与 [Hidden]/[Action] 关键词声明本身已按契约编码，" +
    "其中 Buff 与 Might 两段由 golden 用真实原语执行；Hidden 的 facedown 许可仍属 RIFT-84 的消费接线范围。" +
    "当前缺口：Buff 类别级 continuous.might 消费模型与 cost.hidden 的 Hide/背面区域接线。",
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Buff a friendly unit. Buffs give an additional +1 :rb_might: to friendly units this turn. " +
    "(To buff a unit, give it a +1 :rb_might: buff if it doesn't already have one.)",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          id: "buff-friendly-unit",
          op: "effect.buff",
          args: {
            mode: { kind: "constant", value: "buff" },
            target: { kind: "constant", value: "friendly-unit" }
          },
          targets: [
            {
              id: "friendly-unit",
              filter: { type: "unit", controller: "controller" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "Buffs give an additional +1 Might to friendly units this turn" —
          // an end-of-turn Might modifier over every friendly unit that has a
          // Buff (811.2 keeps the second part location-independent). The
          // merged continuous.might instruction registers one arithmetic-layer
          // effect per resolved object (see judgeReason: the fixed per-object
          // registration does not express the printed class rule for units
          // that gain a Buff later or lose one during the turn).
          id: "buffs-give-additional-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "this-turn" },
            objects: {
              kind: "constant",
              value: {
                kind: "query",
                filter: {
                  zone: "board",
                  type: "unit",
                  controller: "controller",
                  // 702.3/702.3.a 限定一名单位同时只有一个 Buff，因此特征值 1 即「有 Buff」。
                  characteristics: { buffs: 1 }
                }
              }
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default standUnited;
