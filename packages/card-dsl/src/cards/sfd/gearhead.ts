import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Gearhead (sfd-068-221) — Unit, Mind, Zaun.
 * energy 5, power: none printed, Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-068-221，逐字）:
 *   "[Accelerate] (You may pay :rb_energy_1::rb_rune_mind: as an additional cost to have me
 *   enter ready.)\nEach Equipment attached to me gives double its base Might bonus."
 *
 * 规则依据（CR v1.5）:
 * - [Accelerate]（805）：可选附加费用关键词（805.1/805.1.a：出现在 Units 上，805.1.b 的
 *   功能文本 = 「打出时可选支付 [1][C]，若支付则我就绪入场」，本卡域为 Mind，故 C = Mind）。
 *   按契约 3.7 只声明关键词，展开（cost.additional + 入场就绪替代，805.6）由
 *   effects/keywords/Accelerate.ts 负责，卡牌不重写。
 * - "Each Equipment attached to me gives double its base Might bonus"：附件对宿主 Might 的修正
 *   由 Might Bonus（137.1–137.3、435.1.d：Top-Most Card 的 Might 由所有 Attached 卡的
 *   Might Bonus 调制；137.3.a：仅在 Attached 期间生效）在算术图层计算；"double" 是 CR 433.1
 *   式的倍化——按该 Equipment 的**基础** Might Bonus 再增加等量一份（"base" 明确取印刷值，
 *   而不是当前图层计算结果）。这是附着物侧的持续修正，不是本卡的 Buff 计数（702/703）。
 *
 * status 判定（cards/README.md 第 2 节，2026-10-17 逐条实测）：judge-required，两处缺口：
 * - [Accelerate]（805）的展开已合入：accelerate.cost 与 805.6 的入场就绪替代都会产出，替代
 *   也经 attachLifecycle 注册。但生产 static binder 对 accelerate.cost 判
 *   「Static ability kind accelerate.cost has no layer mapping」并 fail-closed，Finalize
 *   因此从不读取这笔可选附加费用；替代是无条件生效的——未支付 [1][Mind] 的单位也直接就绪入场
 *   （模板测试 keyword-static-671.test.mjs 的 805.1.b 边界行以 todo 断言“未支付应横置入场”）。
 * - 「Each Equipment attached to me gives double its base Might bonus」需要附着物正确读取其
 *   Might Bonus（137.1–137.3、435.1.d）特征并按 433.1 式倍化：ObjectSnapshot 没有 Might
 *   Bonus 字段（全仓库唯一出现处就是本卡的 amount 占位串），算术层只处理
 *   add/set/multiply，没有「按附着物基础 Might Bonus 附加等量修正」规则。本卡声明的
 *   continuous.might 确实注册进 arithmetic 层（模板测试实测 filter 只锁本卡自身），但它是
 *   无法求值的占位 amount，实测对 Might 的贡献是 0。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "accelerate" },
  {
    // 137.3/435.1.d：Equipment 的 Might Bonus 调制宿主 Might。"double its base Might bonus"
    // 声明为「按每个附着 Equipment 的基础 Might Bonus 再加一份等量修正」的算术层静态效果；
    // 图层没有该规则、也没有资产附着物 Might Bonus 特征（见 judgeReason）。
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      appliesTo: "self",
      amount: {
        kind: "constant",
        value: "each-attached-equipment-base-might-bonus"
      },
      source: "attached-equipment",
      multiplier: 1,
      baseValue: true
    }
  }
];

const program = {
  canonicalCardId: "card.hash-2c09104cfceee81462b6ee602bc9183760b8851fe12ba9f8a6283f6432704cd4",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处缺口，均实测 fail-closed、不近似实现：" +
    "(1) [Accelerate]（805.1.b/805.1.b.1）的可选附加费用 [1][Mind] 未被收取：生产 static binder 对关键词展开的 " +
    "accelerate.cost 判「Static ability kind accelerate.cost has no layer mapping」，Play/Finalize 因此不读这笔费用；" +
    "已经注册的 805.6 入场就绪替代没有支付前置条件，实测未付 [1][Mind] 的单位同样就绪入场" +
    "（模板测试 keyword-static-671.test.mjs 的 805.1.b 边界行以 todo 断言“未支付应横置入场”）。" +
    "(2)「Each Equipment attached to me gives double its base Might bonus」缺附着物 Might Bonus 特征（137.1–137.3、435.1.d，" +
    "137.3.a 仅在 Attached 期间生效）与算术层倍化：ObjectSnapshot 无 Might Bonus 字段，算术层只处理 add/set/multiply，" +
    "没有「按附着物基础 Might Bonus 附加等量修正」规则；卡侧 continuous.might 虽注册进 arithmetic 层，但其 amount 是无法求值的占位串，" +
    "实测对本卡 Might 的贡献为 0。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_mind: as an additional cost to have me enter ready.)\n" +
    "Each Equipment attached to me gives double its base Might bonus."
} satisfies CardProgram;

export default program;
