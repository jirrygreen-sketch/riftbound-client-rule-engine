import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Ornn, Forge God (sfd-085-221) — Unit, Mind, Ornn/Freljord/Champion.
 * energy 6, power: none printed, Might 4.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-085-221，逐字）:
 *   "[Deflect 2] (Opponents must pay :rb_rune_rainbow::rb_rune_rainbow: to choose me with a spell
 *   or ability.)\n"
 *   "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for
 *   :rb_rune_rainbow: less, even if it's already attached.)\n"
 *   "I have +1 :rb_might: for each friendly gear."
 *
 * 规则依据（CR v1.5）:
 * - [Deflect 2]（809.1/809.1.b.2）：Passive Ability 关键词，格式 "Deflect [X]"，X 是 Deflect Value
 *   （809.1.b.2；省略时按 1，809.1.b.3）。809.1.c 功能上等价于「对手选择我时其费用额外增加 X Power
 *   （任意域，809.1.c.1）」，属 356.2.a.2 的强制附加费用（809.1.d）。按契约 3.7 只声明
 *   { kind: "keyword", keyword: "deflect", value: 2 }，展开（target.tax 静态效果）由
 *   effects/keywords/Deflect.ts 负责，卡牌不重写。
 * - [Weaponmaster]（821）：Triggered Ability 关键词，821.1.b 规定它是 Play Effect；821.1.c 的功能
 *   短句为「When you play me, you may choose a Card you control with Equip, then attach it to me,
 *    paying its Equip cost reduced by [A]」（821.1.c.1：没有 Equip 能力的 Equipment 也可被选；
 *   821.1.c.6：这不是启动 Equip 能力）。按契约 3.7 只声明 { kind: "keyword", keyword: "weaponmaster" }，
 *   展开由 effects/keywords/Weaponmaster.ts 负责。
 * - "I have +1 :rb_might: for each friendly gear"：静态数值修正，属算术图层（143.2.a、475–478）；
 *   "for each friendly gear" 是求值时按当前局势计数的量（356.4.g 型的应用时检查；同 sfd/orrnn-forge 类的
 *   卡「每件友方装备」），"friendly" = 你控制（190.6.d）。"+1 Might" 是连续修正，不是 Buff 计数
 *   （702/703：Buff 是每单位限一个的 +1 计数器）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，三处依赖未合入，均不近似实现：
 * - Deflect 的 card 侧声明可用（809.1.b.2），但其展开 target.tax 的图层消费方（RIFT-90）尚未与卡牌
 *   关键词注册表接通（effects/keywords/Deflect.ts 文件头记录同一缺口）。
 * - Weaponmaster 展开缺三块（effects/keywords/Weaponmaster.ts 文件头记录）：play-effect 目标层需绑定
 *   符号 controller 过滤并提供被选 Equipment、cost.modify/cost.pay 需计算 Equip 费并按 821.1.c.2 减免
 *   一个任意域 Power 后支付（且不启动 Equip 能力，821.1.c.6）。
 * - 「I have +1 :rb_might: for each friendly gear」需要按当前友方 gear 数量求值的 continuous.might：
 *   契约 3.6 的封闭 GameAction 集合无 Might 修改动作、effects/instructions/ 下无注册 continuous.might 的
 *   指令，也没有卡牌 static 能力 → 图层注册的消费方（RIFT-91 后续）；同时图层条件的计数谓词
 *   （for each friendly gear）不在已合入的 layers/engine.ts conditionMatches 词汇内。
 * 依赖：RIFT-90（target.tax 与关键词注册）、RIFT-89（cost.modify 接线）、RIFT-91 后续（计数型图层修正与卡牌持续效果注册）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "deflect", value: 2 },
  { kind: "keyword", keyword: "weaponmaster" },
  {
    // 「I have +1 :rb_might: for each friendly gear」— 算术图层的计数型静态修正
    // （143.2.a、475–478）；没有任何已合入消费方注册或求值它（见 judgeReason），
    // 也绝不用 Buff 计数近似（702/703）。
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      appliesTo: "self",
      amount: {
        kind: "count",
        subject: "friendly-gear",
        filter: { type: "gear", zone: "board", controller: "self" }
      },
      perObject: true
    }
  }
];

const program = {
  canonicalCardId: "card.hash-d608aa993147100b60121de9bd89000a5f21f0b389c96138c079609d8ffa4004",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处依赖未合入，均不近似实现：(1) [Deflect 2]（809.1.b.2、356.2.a.2 的强制附加费用）的 card 侧声明可用，" +
    "但其展开 target.tax 的图层消费方尚未与卡牌关键词注册表接通（RIFT-90；effects/keywords/Deflect.ts 文件头记录同一缺口）。" +
    "(2) [Weaponmaster]（821.1.b/821.1.c）的展开缺三块：play-effect 目标层需绑定符号 controller 过滤并提供被选 Equipment、" +
    "cost.modify/cost.pay 需按 821.1.c.2 计算 Equip 费并减免一个任意域 Power 后支付，且不得启动 Equip 能力（821.1.c.6）。" +
    "(3)「I have +1 :rb_might: for each friendly gear」是按当前友方 gear 数量求值的连续 Might 修正（143.2.a、475–478）：" +
    "契约 3.6 的封闭 GameAction 集合无 Might 修改动作、effects/instructions/ 下没有注册 continuous.might 的指令，" +
    "也没有卡牌 static 能力 → 图层注册的消费方（RIFT-91 后续）；layers/engine.ts 的 conditionMatches 也不认识计数谓词。" +
    "绝不把 +1 Might 写成 Buff 计数（702/703 语义不同）。依赖：RIFT-90、RIFT-89、RIFT-91 后续。",
  abilities,
  sourceText:
    "[Deflect 2] (Opponents must pay :rb_rune_rainbow::rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)\n" +
    "I have +1 :rb_might: for each friendly gear."
} satisfies CardProgram;

export default program;
