import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Seal of Rage (ogn-040-298) — Gear, 0 Energy + 1 Fury power, Fury.
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-040-298):
 *   :rb_exhaust:: [Reaction] — [Add] :rb_rune_fury:.
 *   (Abilities that add resources can't be reacted to.)
 *
 * 规则依据（CR v1.5）：
 * - “:rb_exhaust:: …” 是 Gear 的启动能力（151、151.2），费用是横置自身（415.3.a/415.5）。
 * - “[Reaction]” 是许可类关键词（813）：按 813.1.d 写在能力上的形式为 “[Reaction][>]”，
 *   把该启动能力的时机改写为 Closed State（也含 Showdown，813.1.b/813.2）。契约 3.1 的
 *   ActivatedAbility.timing 只有 "action" | "reaction" 两档，因此这里声明 timing: "reaction"，
 *   Reaction 关键词的展开（continuous.timing，813）由关键词注册表负责。
 * - “[Add] :rb_rune_fury:.” 是 Add 动作（430）：格式 “:rb_rune_fury:” 按 430.5 的示例
 *   “:rb_rune_fury:”＝“Add 1 Power of the Fury domain”。effect.resources 正是该原语，
 *   资源加法在 430.2 立即结算、不传优先权（430.2.a），但那是本原语的调用方时机边界，
 *   原语本身只提交 gain-power 动作。括号里“Abilities that add resources can't be reacted to”
 *   是 430.2.a 的说明文本，不改变效果本体。
 *
 * status = executable：Gear 启动能力的费用（cost.exhaust）、Reaction 时机声明、
 * effect.resources 的 Fury 力量加法都有已合入的实现路径与真实执行测试；Reaction 的
 * 许可展开（continuous.timing 静态能力）由引擎关键词注册表在读取关键词特征时提供，
 * 卡牌只声明自己的速度（契约 3.5：卡牌只声明自己的速度与限制）。
 */
const abilities: Ability[] = [
  {
    kind: "activated",
    // “:rb_exhaust::” — 横置自身作为启动费用（415.3.a、415.5）。
    cost: { kind: "activated", payments: [{ kind: "exhaust" }] },
    // “[Reaction] —” 是能力上的 Reaction 许可（813.1.d、813.2）：Closed State 也可启动。
    timing: "reaction",
    body: [
      {
        id: "seal-of-rage.add-fury",
        // “[Add] :rb_rune_fury:.” — Add 1 Fury Power（430.1、430.5 的格式示例）。
        op: "effect.resources",
        args: {
          power: { kind: "constant", value: ["Fury"] }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-8ecba382226849757c2ac004a54b1ce00f2d0d303a1d99520e1855117bd7a161",
  rulesetVersion: "core-1.5" as const,
  status: "executable" as const,
  abilities,
  sourceText:
    ":rb_exhaust:: [Reaction] — [Add] :rb_rune_fury:. " +
    "(Abilities that add resources can't be reacted to.)"
} satisfies CardProgram;

export default program;
