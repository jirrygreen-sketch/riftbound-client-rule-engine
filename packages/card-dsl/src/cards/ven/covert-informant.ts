import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Covert Informant (ven-057-166) — Unit, Mind, Noxus.
 *
 * 原文：
 *   [Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)
 *   [Empowered][>] When I move, draw 1.
 *
 * 规则依据（Core Rules v1.5）：
 * - 827.1 / 827.1.c.1：Empower 是 Activated Ability 关键词；本卡印刷费用 3 Energy。
 * - 828.1 / 828.1.c："[Empowered][>]" 后的整句是 Dependent Ability，只在拥有
 *   Empowered 状态时 Active。
 * - 421.1 / 421.2 / 421.3："When I move" 指本永久物在 Board 上更换位置成功完成后
 *   的触发；时点用封闭枚举里的 "object-moved"（events/timing-points.ts 的
 *   movement payload，ruleRefs 421.1/449.1/449.2/458；说明里明确"成功完成 Move"、
 *   Recall/入场/Attach 不算 Move）。filter 用契约 3.6 的符号选择器指向自身。
 * - "draw 1" = effect.draw（414.1/414.3，已合入原语）；抽牌者缺省为能力控制者
 *   （190.6.d 的隐含 "you"），不写死玩家 id。
 *
 * 结构说明：本卡不自己判断"是否已 Empowered"（那属 828.1.c 的关键词门控），也不
 * 复制 move 的流程。
 */
const abilities: Ability[] = [
  {
    kind: "keyword",
    keyword: "empower",
    value: 3
  },
  {
    kind: "triggered",
    trigger: {
      at: "object-moved",
      filter: {
        event: "object-moved",
        filter: { source: "self" }
      }
    },
    optional: false,
    body: [
      {
        id: "covert-informant.draw",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-a7852cd3cb51ac726ccf3fd549d64c739122b2160a5f283dd604718dda7c5bb6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「[Empower] 3」与「[Empowered][>]」依赖尚未合入的 Empower / Empowered KeywordDef" +
    "（RIFT-83/84 关键词展开）。827.1.c.1 的起动费用（cost.activated + effect.empower）与 828.1.c 的" +
    "状态门控没有实现，所以这条「When I move, draw 1」目前无法按 Dependent Ability 生效。" +
    "触发结构与 effect.draw 本体的时点（object-moved，421.1/449.1）与抽牌原语均已合入，可单独执行验证；" +
    "不把依赖能力改成无条件能力，也不在卡里手写 Empowered 判定。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] When I move, draw 1."
} satisfies CardProgram;
