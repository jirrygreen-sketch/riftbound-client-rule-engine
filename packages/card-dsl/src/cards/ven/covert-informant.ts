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
 *
 * 复核（2026-10-17，第一轮 M2 覆盖率复核）：object-moved 时点确实已由
 * events/action-adapter.ts 的 move-location 映射发出（timing-point-producers.md 亦记载
 * 「仅 move-location；Recall/入场/Attach 不复用」），effect.draw 也是合入原语——golden
 * 已用生产链适配器真实执行 draw 1。仍不可执行的是 828.1.c 的 Empowered 门控：
 * ObjectSnapshot / Condition 没有 442.1.a 的二元状态，layers/engine.ts 的 conditionMatches
 * 对未知 kind 落回 true，把「When I move, draw 1」按无门控的依赖能力绑定会比印刷更强。
 * 另外 `filter: { source: "self" }` 这种嵌套 EventPattern 形状的自我作用域依赖
 * programs/filters.ts 的翻译（它会翻成 objectId = 来源），该翻译已合入；未合入的是
 * Empower / Empowered 的 KeywordDef 与门控。
 *
 * status = judge-required（缺口）：
 * 1. 没有 Empower / Empowered KeywordDef：827.1.c.1 的起动费用与 828.1.c 的状态门控无实现；
 * 2. 442.1.a 的 Empowered 二元状态不在 ObjectSnapshot / Condition 中，依赖能力无法按
 *    「仅当已 Empowered」绑定。
 * 触发结构与 effect.draw 本体（object-moved，421.1/449.1）已合入并真实执行。
 * 不把依赖能力改成无条件能力，也不在卡里手写 Empowered 判定。
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
    "两条缺口：（1）没有 Empower / Empowered KeywordDef——827.1.c.1 的起动费用与 828.1.c 的状态门控无实现；" +
    "（2）442.1.a 的 Empowered 二元状态不在 ObjectSnapshot / Condition 中，layers/engine.ts 的" +
    "conditionMatches 对未知 condition kind 落回 true，所以「When I move, draw 1」无法按 828.1.c 的" +
    "Dependent Ability 绑定（直接绑定会变成无门控，比印刷更强）。" +
    "触发结构与 effect.draw 本体的时点（object-moved，421.1/449.1）与抽牌原语均已合入：时点由" +
    "events/action-adapter.ts 的 move-location 映射发出，golden 用生产链适配器真实抽 1 张。" +
    "不把依赖能力改成无条件能力，也不在卡里手写 Empowered 判定。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] When I move, draw 1."
} satisfies CardProgram;
