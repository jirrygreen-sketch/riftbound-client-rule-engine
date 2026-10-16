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
 * Status: judge-required — the two keyword halves and the timed grant are
 * merged (Tank's KeywordDef at RIFT-264, Shield's at the earlier keyword batch,
 * continuous.grant-keyword at RIFT-258), but the whole card still cannot run:
 * - no merged producer binds a static/play CardProgram ability into the
 *   layer/chain pipeline (RIFT-257), so the duration-bound grant is never
 *   registered from the card;
 * - [Tank]'s expansion is a continuous.combat effect and the combat damage
 *   assignment path has no consumer for it (base-combat-allocation.ts records
 *   "No Tank/Backline/other assignment-priority requirement is bound here"),
 *   so the printed assignment order is not enforced;
 * - Shield's expansion is conditional on the Defender designation
 *   (814.1.d, 466.2.c.3) handed out by the Combat flow.
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
    "“Give a unit [Shield 3] and [Tank] this turn”的单个关键词与授予原语都已合入：Tank 的 KeywordDef（RIFT-264，815）、" +
    "Shield 的 KeywordDef（814，带数值叠加）、continuous.grant-keyword（RIFT-258，end-of-turn 期限；本卡测试真实执行并验证" +
    "Shield 3 与 Tank 在 ability 层的注册和到期清理）。仍缺三处：" +
    "(1) 没有已合入的绑定层把卡牌静态/play 能力注册进图层与链（RIFT-257），整卡的授予不会被生产路径登记；" +
    "(2) Tank 展开为 continuous.combat，战斗伤害指派路径没有消费方（combat/base-combat-allocation.ts 明确未绑定指派优先级），815.1.b/815.1.c.2 不生效；" +
    "(3) Shield 展开依赖 combat 流程赋予的 Defender 身份（814.1.d / 466.2.c.3）。" +
    "依赖：RIFT-257 卡牌程序绑定、continuous.combat 的 combat 指派消费方与 combat 身份流程。" +
    "不近似实现：不丢掉 [Tank] 半段，也不把 Shield 直接折算成 Might 修改（814.1.c 只在作为防守者时 +X Might）。" +
    "[Hidden]/[Action] 仅为关键词声明（811/806），facedown 许可依赖 cost.hidden（RIFT-261）。",
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
          // halves stay visible; the grant runs through the merged
          // continuous.grant-keyword primitive, while the card-program binding
          // and the combat consumer remain open (see judgeReason).
          id: "grant-shield-3-and-tank",
          op: "continuous.grant-keyword",
          args: {
            // 814.1.b.2: Shield carries its Shield Value (3); Tank is unvalued
            // (815.1). The object-array form is the one that keeps the value:
            // continuous.grant-keyword ignores `value` when `keywords` is given.
            keywords: { kind: "constant", value: [{ id: "Shield", value: 3 }, { id: "Tank" }] },
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
