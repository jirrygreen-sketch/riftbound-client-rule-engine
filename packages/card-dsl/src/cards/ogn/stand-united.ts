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
 * Status: judge-required — the second sentence is not expressible:
 * "Buffs give an additional +1 :rb_might: to friendly units this turn" changes
 * what a Buff contributes for the rest of the turn (CR 703 states the printed
 * baseline: each Buff individually contributes +1 Might). That is a
 * duration-bounded Might modifier applied to every friendly unit that has a
 * Buff (811.2's Stand United example confirms the second part affects all
 * friendly units with buffs regardless of location, unlike the first part), so
 * it needs a continuous.might registration with an end-of-turn duration and a
 * "has a buff" filter. No effects/instructions file registers continuous.might
 * through ResolveContext.addContinuous, so the +1 is not applied (the layers
 * engine itself does evaluate arithmetic-layer Might modifications, but a card
 * cannot reach it without that opcode). Not approximated by buffing extra
 * units or by granting a second Buff counter (702.3 / 427.1.b.1 forbid more
 * than one Buff, and a Buff counter is not a Might modification).
 */
const standUnited = {
  canonicalCardId: "card.hash-40071acacac7084766aaea4ce4329db5541d659f9ec5225d9dc853542a456664",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "“Buffs give an additional +1 Might to friendly units this turn”无法执行：CR 703 是 Buff 的印刷基线" +
    "（每个 Buff 贡献 +1 Might），本句在整回合内改写该贡献，属于带 end-of-turn 期限、作用于“拥有 Buff 的友方单位”" +
    "（811.2 的 Stand United 示例明确该部分不受所在地点限制）的 continuous.might 持续效果；" +
    "effects/instructions 下没有任何原语通过 ResolveContext.addContinuous 注册它（layers 引擎已能求值 arithmetic 层，但没有指令入口）。" +
    "依赖：continuous.might 指令原语（RIFT-9 清单；RIFT-91 已合入 layers 求值侧）。" +
    "不近似实现：不能多发一个 Buff（702.3/427.1.b.1 禁止第二个 Buff，且 Buff 计数不是 Might 修改）。" +
    "“Buff a friendly unit”（427.1.b / effect.buff）与 [Hidden]/[Action] 关键词声明本身已按契约编码，" +
    "其中 Buff 半段由 golden 用真实原语执行；Hidden 的 facedown 许可仍属 RIFT-84 范围。",
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
          // Buff (811.2 keeps the second part location-independent). No merged
          // primitive registers it (see judgeReason).
          id: "buffs-give-additional-might",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "this-turn" },
            appliesTo: {
              kind: "constant",
              value: { type: "unit", controller: "controller", hasBuff: true }
            }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

export default standUnited;
