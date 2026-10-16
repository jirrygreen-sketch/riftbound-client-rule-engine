import type { CardProgram } from "../../ir/index.js";

/**
 * Reflection (unl-t06) — Colorless 单位 token，Might 0，标签 Token。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-t06，逐字）：
 *   (I become a copy of something when played. I don't get that card's play
 *   effects.)
 *
 * 规则依据（CR v1.5）——为什么这是 no-ability 而不是 judge-required：
 * - 135.2.d.1：reminder text（提醒文字）以斜体写在圆括号中；135.2.d.2 说明其用途是
 *   概括相关规则；135.2.d.3 明确“提醒文字的有无与具体措辞对游戏功能没有任何影响”。
 *   本印刷的 ability 字段整段都在圆括号内（本地目录里唯一这样的实例），属提醒文字，
 *   不产生卡牌自己的能力。
 * - 187.6：0 [M] Reflection token 的**定义**是「无领域、0 Might 的单位 token」；
 *   token 的特征由创建它的法术或能力给出（187），不在本 token 印刷上。
 * - 446.3：以 copy 方式创建的对象不是 Copy Effect——“直接以被复制对象的印刷特征创建”，
 *   它没有自己随后被替换的印刷特征；因此「becomes a copy … when played」的复制指令属于
 *   创建它的效果正文（例如 unl-200-219 Mirror Image 的 “It becomes a copy of that unit.”、
 *   unl-199-219 Deceiver 的 “It becomes a copy of another unit there.”），不写在本 token 上。
 * - 同理 “I don't get that card's play effects.” 描述的是 446.3 的结果：token 不是被
 *   「打出」的牌，不产生 383.4.a 的 Play Effect（Play Effect 属于被加到链上并进场的永久物）。
 * - 185.3.a / 185.3.b：token 没有费用与领域，其 printed cost 记为 0 只是为了计算；
 *   本印刷的 energy/power 均为 null（无印刷值），不得改写为 0。
 *
 * 结构：没有任何卡牌自己的能力 → `abilities: []`，status = `no-ability`（README 第 2 节：
 * 经官方卡面确认没有能力文本，不是“还没实现”的占位状态）。sourceText 保留目录中的逐字原文
 * 以便审查；本卡的 Might/领域/标签等印刷特征由 packages/card-data 的目录数据承载。
 */
export default {
  canonicalCardId:
    "card.hash-7538c2135b030e4e91c01e4952055324c62e0182b94d2d0bf0c272f7f55e2373",
  rulesetVersion: "core-1.5",
  status: "no-ability",
  abilities: [],
  sourceText:
    "(I become a copy of something when played. I don't get that card's play effects.)"
} satisfies CardProgram;
