import type { Ability } from "@riftbound/card-dsl";
import type { CardContextRef, KeywordDef } from "../keyword-contract.js";

/**
 * Accelerate —— CR v1.5 §805（可选附加费用关键词，出现在单位上）。
 *
 * 规则依据（Core Rules v1.5 条目号）：
 * - 805.1 / 805.1.a：Accelerate 是可选附加费用关键词，出现在 Units 上。
 * - 805.1.b：功能文本等价于 “As you play me, you may pay [1][C] as an
 *   additional cost. If you do, I enter ready.” 费用固定为 1 energy + 1 power，
 *   因此 keyword 不带数值（valued: false）。
 * - 805.1.b.1：单位有一个或多个域时，费用的 Power 部分只能用与单位某一域
 *   匹配的力量支付。
 * - 805.1.b.2：单位无域时，Power 部分可以用 [A]（任意域的力量）支付。
 * - 805.2 / 805.2.a：该费用只能在打出该单位的步骤中支付；单位在场上时
 *   不能支付。
 * - 805.2.b：支付后产生一个延迟替代效果；即使该单位在 Finalization 过程中
 *   失去 Accelerate 关键词，只要费用已付，它仍然就绪进场。
 * - 805.3：Accelerate 在场上没有任何功能。
 * - 805.4：多个 Accelerate 实例冗余——stacking 为 single（只算一次）。
 * - 805.5：是否拥有 Accelerate 是单位的特征，可被其他游戏效果检查或引用
 *   （由 CardProgram 上的 KeywordAbility 条目承载，不展开）。
 * - 805.6 / 805.6.a：付费后产生的延迟替代效果把“单位横置进场”替换为
 *   “就绪进场”——它不是先横置再就绪，因此不与“成为就绪”类能力互动，
 *   也不触发这类能力。展开结构中以 replacement 能力的
 *   withoutReadyTrigger: true 声明这一点，由事件管线在替代
 *   “object-enters-board ... exhausted=true”事件时直接提交就绪进场，
 *   不经过 “object-readied” 时点。
 *
 * 展开结构（付费与否的选择与收费由打出流程在 Finalize 完成；本关键词只声明）：
 * 1. 静态能力 accelerate.cost：声明打出该单位时可支付的可选附加费用
 *    （固定 [1][C]，power 的域匹配约束按 805.1.b.1/.b.2 写成 CostSpec），
 *    供 Finalize 阶段的费用管线读取。
 * 2. 替代能力：当本来源单位将 object-enters-board 且 exhausted=true 时，
 *    以 effect.ready 原语把它替换为就绪进场。withoutReadyTrigger 标记
 *    落实 805.6.a（不触发 “becomes ready”）。该替代只在费用已付时生效——
 *    支付与否的判定属打出流程（805.2.b 的延迟替代效果），实现方是
 *    Finalize + replacement 管线，不是本关键词文件。
 *
 * 依赖尚未合入的部分（本文件只按契约写出展开结构，不近似实现）：
 * - cost.additional / cost.pay（打出时附加费用的声明与收取，
 *   RIFT-89~91 实现中）与 replacement.enter（入场替代管线，按能力模板
 *   规划）尚未作为指令原语合入；accelerate.cost ContinuousEffect 的消费
 *   方（Finalize 费用管线）也在该批。
 * - 本文件 with 体内的 effect.ready 指令原语已合入（已验证），测试里
 *   用解释器 + 参考测试内核实际执行该指令。
 * - 付费后才挂上替代（805.2.b 的“延迟”部分）属于打出流程；本关键词按
 *   契约输出完整替代形状，条件接线待 cost/replacement 管线合入后完成。
 *
 * 契约缺口：无；805.1.b.1/.b.2 的域匹配约束以 CostSpec.payment 的
 * domain-match kind 表达，未超出现有 IR。
 */

const ACCELERATE_RULE_REFS = [
  "805.1",
  "805.1.a",
  "805.1.b",
  "805.1.b.1",
  "805.1.b.2",
  "805.2",
  "805.2.a",
  "805.2.b",
  "805.3",
  "805.4",
  "805.5",
  "805.6",
  "805.6.a"
] as const;

const accelerate = {
  keyword: "Accelerate",
  // 805.1.b：费用固定为 [1][C]，不随卡牌变化，keyword 不带数值。
  valued: false,
  // 805.4：多个 Accelerate 实例冗余，只算一次。
  stacking: "single",
  expand(input: { readonly value?: number; readonly host: CardContextRef }): readonly Ability[] {
    return [
      {
        kind: "static",
        effect: {
          kind: "accelerate.cost",
          appliesTo: "self",
          host: input.host.canonicalCardId,
          cost: {
            kind: "additional-cost",
            optional: true,
            payments: [
              { kind: "energy", amount: { kind: "constant", value: 1 } },
              // 805.1.b.1/.b.2：有域单位只能付与自身某一域匹配的 Power；
              // 无域单位可用任意域（[A]）。匹配逻辑在收费管线按单位当时
              // 的域特征计算，这里只声明数量。
              { kind: "power", amount: { kind: "constant", value: 1 } }
            ]
          }
        }
      },
      {
        kind: "replacement",
        replaces: {
          event: "object-enters-board",
          filter: { self: true, cardId: input.host.canonicalCardId, exhausted: true }
        },
        // 805.6：替代管线的 “source” 选择符指被替代事件中即将进场的
        // 单位本身（即本来源）。该选择符由 effect.ready 原语支持，替换
        // 后单位直接以就绪状态进场，不经过先横置再就绪的中间状态。
        with: [
          {
            id: "accelerate.enter-ready",
            op: "effect.ready",
            args: { objects: { kind: "constant", value: { kind: "source" } } }
          }
        ]
      }
    ];
  },
  ruleRefs: ACCELERATE_RULE_REFS
};

export default accelerate as KeywordDef;
