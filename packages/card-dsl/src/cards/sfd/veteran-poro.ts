import type { CardProgram } from "../../ir/index.js";

/**
 * Veteran Poro (sfd-099-221) — Unit, fiora-sfd (M1).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, sfd-099-221):
 *   [Weaponmaster] (When you play me, you may [Equip] one of your Equipment
 *   to me for :rb_rune_rainbow: less, even if it's already attached.)
 *
 * 规则依据（CR v1.5）：821.1 / 821.1.c：Weaponmaster 在打出时允许把一个自己的 Equipment
 * 以其 Equip 费用减 [A] 附着到本单位（821.1.c.1/.c.2 的减费与支付、821.1.c.7 的「已附着也
 * 可以重新附着」）。卡牌只声明关键词（契约 3.7），展开归 effects/keywords/Weaponmaster.ts。
 *
 * status = judge-required：关键词展开文件已合入（RIFT-87）并能通过 validateCardProgram
 * （见 golden 的结构断言），但它的展开体需要尚未合入的原语：展开为 card-played 触发 +
 * sequence（cost.modify → cost.pay → effect.attach），而 cost.modify / cost.pay 在
 * effects/instructions/registry.generated.ts 里没有定义（RIFT-261 未合入：实测
 * instructionDefinitionsById 不含这两个 op，展开体在生产链上会因未注册 opcode 抛错）。
 * 另外卡牌程序→关键词展开→链的静态/触发注册只有 programs/ 的默认 noopStaticBinder。
 * 不近似实现：不用全价 Equip、不用其他资源替代 [A]（163.2.b 的 Universal Power）。
 * 依赖：RIFT-261（cost.pay / cost.modify）与 RIFT-257 后续的绑定接线。
 */
const veteranPoro = {
  canonicalCardId: "card.hash-77fdefa1bb982497df81cd6fd64fdde8c460c8cfb52aa2708aa568b849ca42e7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Weaponmaster]（821.1）的展开体需要尚未合入的费用原语：已合入的 effects/keywords/Weaponmaster.ts（RIFT-87）把关键词展开为 card-played 触发 + " +
    "sequence（cost.modify → cost.pay → effect.attach），展开形状本身通过 validateCardProgram，但 cost.modify / cost.pay 在 " +
    "effects/instructions/registry.generated.ts 中没有定义（RIFT-261 未合入；实测 instructionDefinitionsById 不含这两个 op），" +
    "生产链执行展开体会在未注册 opcode 处抛错，无法完成 821.1.c 的「以 Equip 费用减 [A] 支付后附着」（163.2.b 的 [A] 为 Universal Power）。" +
    "另缺卡牌程序→关键词展开的绑定消费方（programs/statics.ts 默认 noopStaticBinder，RIFT-257 后续）。" +
    "不近似实现：不用全价 Equip、不用具名域替代 [A]。依赖：RIFT-261 与 RIFT-257 后续绑定接线。",
  abilities: [{ kind: "keyword", keyword: "weaponmaster" }],
  sourceText:
    "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)"
} satisfies CardProgram;

export default veteranPoro;
