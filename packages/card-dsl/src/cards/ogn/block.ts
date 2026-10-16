import type { CardProgram } from "../../ir/index.js";

/**
 * Block (ogn-057-298) — Spell, 2 energy (Calm).
 *
 * Printed text:
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)
 *   [Action] (Play on your turn or in showdowns.)
 *   Give a unit [Shield 3] and [Tank] this turn. (+3 :rb_might: while it's a
 *   defender. It must be assigned combat damage first.)
 *
 * Modeling notes (Core Rules v1.5):
 * - [Hidden] (811) and [Action] (806) are keyword abilities expanded by the
 *   keyword registry (contract 3.7); the card only names them. Hidden's
 *   facedown play permission stays with RIFT-84.
 * - "Give a unit ... this turn" is a duration-bounded keyword grant. A keyword
 *   is not an instruction: keywords reach an object through the layers system
 *   as a static/continuous grant (contract 3.4 layer order copy -> trait ->
 *   ability -> arithmetic), and "a unit" is this ability's target (355.7). The
 *   grant is declared as the continuous.grant-keyword shape merged SFD
 *   programs use for the same mechanic.
 *
 * Status: judge-required — both halves of the grant are unmerged:
 * - The frozen keyword registry has no Tank KeywordDef at all (CR 815: Tank is
 *   a Passive Ability keyword of Units whose functional text is a combat
 *   damage assignment order requirement, 815.1.b / 815.1.c.2 / 815.2), so the
 *   [Tank] half cannot be declared or expanded.
 * - A grant with an end-of-turn lifetime needs a continuous grant layer that
 *   expires at the turn-end timing point (CR 816-style temporary grants; the
 *   layers registry supports an end-of-turn duration, but no merged
 *   instruction or keyword expansion registers a grant through it). Shield's
 *   merged KeywordDef (814) expands to a static continuous.might conditioned on
 *   the Defender designation, and that designation is assigned by the Combat
 *   flow (814.1.d, 466.2.c.3), which is not wired.
 * Granting a permanent Shield while leaving Tank and the expiry unsupported
 * would report a wrong board state, so the grant stays unexecutable as a
 * whole. Not approximated: the [Tank] half is not dropped, and the Shield
 * value is not baked into a Might change (814.1.c: Shield is +X Might only
 * while the unit is a defender).
 */
const block = {
  canonicalCardId: "card.hash-211d0bb8cf4f5b5202c2a9b7996e483898644aa24714b1e10edd80a54ba4b560",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "“Give a unit [Shield 3] and [Tank] this turn”缺两条已合入路径：" +
    "(1) 关键词注册表没有 Tank 的 KeywordDef（CR 815：Tank 是单位的被动关键词，功能文本是战斗伤害指派顺序要求，815.1.b/815.1.c.2/815.2），无法声明或展开；" +
    "(2) 带 end-of-turn 期限的关键词授予需要 continuous.grant-keyword 持续效果在 layers 的 ability 层落地并按 CR 816 一类临时授予到期清理，" +
    "当前没有任何已合入的原语/关键词展开注册它；Shield 的 KeywordDef（814）展开还依赖 combat 流程赋予的 Defender 身份（814.1.d / 466.2.c.3，combat 未接线）。" +
    "依赖：kw-tank 关键词展开（RIFT-83 关键词范围）、continuous.grant-keyword 指令/持续效果（RIFT-9 清单；layers 求值侧已随 RIFT-91 合入，但无指令入口）、combat 身份流程（契约 7.2 批 5）。" +
    "不近似实现：不丢掉 [Tank] 半段，也不把 Shield 直接折算成 Might 修改（814.1.c 只在作为防守者时 +X Might）。" +
    "[Hidden]/[Action] 仅为关键词声明（811/806），facedown 许可属 RIFT-84。",
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Give a unit [Shield 3] and [Tank] this turn. (+3 :rb_might: while it's a defender. " +
    "It must be assigned combat damage first.)",
  abilities: [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          // "Give a unit [Shield 3] and [Tank] this turn" — one duration-bound
          // keyword grant over the ability's target (355.7). Both keyword
          // halves stay visible; no merged consumer registers a timed grant
          // (see judgeReason).
          id: "grant-shield-3-and-tank",
          op: "continuous.grant-keyword",
          args: {
            keywords: { kind: "constant", value: ["Shield", "Tank"] },
            value: { kind: "constant", value: 3 },
            duration: { kind: "constant", value: "this-turn" }
          },
          targets: [
            {
              id: "granted-unit",
              filter: { type: "unit" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ]
} satisfies CardProgram;

export default block;
