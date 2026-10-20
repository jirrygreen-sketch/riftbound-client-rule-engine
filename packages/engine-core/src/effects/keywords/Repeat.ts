import type { Ability, CostSpec, Value } from "@riftbound/card-dsl";
import type { CardContextRef, KeywordDef } from "../keyword-contract.js";

/**
 * Repeat —— CR v1.5 §820（可选附加费用关键词，出现在法术与能力上）。
 *
 * 规则依据（Core Rules v1.5 条目号）：
 * - 820.1 / 820.1.a：Repeat 是可选附加费用关键词，出现在 Spells 与 Abilities 上。
 * - 820.1.b / 820.1.d：付费后在结算时把该链项的指令额外执行一次；功能文本等价于
 *   “你可在打出此牌/此能力时支付 [Cost] 作为附加费用；若支付，结算时将该链项的
 *   指令额外执行一次”。
 * - 820.1.c：印刷格式为 “Repeat [Cost]”，费用本身来自卡牌印刷文本
 *   （KeywordAbility 实例的 cost 参数），不是 keyword 的数值。
 * - 820.1.c.2 / 820.1.c.3 / 820.3：同一来源上的多个 Repeat 实例各自独立、可分别
 *   支付（每个只能付一次），每支付一个实例结算时就多执行一次——因此
 *   stacking 为 separate。
 * - 820.2 / 820.2.a：额外执行的选择照常做出，可以与首次执行不同。解释器内建的
 *   repeat 指令在每一次迭代里以重新选择模式结算目标（reselect），本条由
 *   解释器承担，关键词本身不写流程。
 * - 820.3.a：无论指令被执行多少次，该牌/能力只被打出一次（不产生额外
 *   card-played 时点）；这也是解释器 repeat 迭代的既有行为。
 * - 820.1.d.2：结算时未被执行的指令被忽略——与解释器对 negated/ignored
 *   指令的既有处理一致。
 *
 * 展开结构：一个静态能力 repeat.cost，声明该来源带有一个独立的可选附加
 * 费用 Repeat 实例（820.1.c.2 要求各实例分别支付；stacking 为 "separate"
 * 时合并管线会把每个印刷实例各自展开一次，注册的数量即实例数）。费用的
 * 组成由打出流程（Finalization，349）读取该持续效果中的 cost 描述，付费
 * 结果记到链项上；结算时由打出管线用解释器内建 repeat 指令按付费实例数
 * 重新执行链项正文（见下方依赖说明）。
 *
 * 消费边界：CardProgram 的原始 Repeat 参数先由 play / cost adapter 规范为
 * optionalAdditional；Finalize 的冻结 plan 与付款 receipt 再由 chain
 * interpreter adapter 按实例 id 交叉校验。每个已付实例只贡献一次额外执行，
 * Resolve 不重新决定支付，也不把 Repeat 当成再次打出。
 *
 * 契约缺口：无。820.1.c 的费用描述以 ContractExpr 常量形式挂在
 * repeat.cost 的 cost 键上，形状与 CostSpec 兼容。
 */

const REPEAT_RULE_REFS = [
  "820.1",
  "820.1.a",
  "820.1.b",
  "820.1.c",
  "820.1.c.2",
  "820.1.c.3",
  "820.1.d",
  "820.1.d.1",
  "820.1.d.2",
  "820.2",
  "820.2.a",
  "820.3",
  "820.3.a"
] as const;

// Missing printed cost is unsupported information. In particular, do not
// turn a null/omitted print into a free 0-Energy Repeat.
const REPEAT_COST_DEFAULT = { kind: "repeat" } as const;

interface RepeatKeywordInput {
  readonly value?: number;
  readonly host: CardContextRef;
  /** 印刷的 “Repeat [Cost]” 费用描述；缺省时按无费用实例声明。 */
  readonly cost?: CostSpec;
  readonly params?: Readonly<Record<string, Value | CostSpec | undefined>> & { readonly cost?: CostSpec };
}

const repeat = {
  keyword: "Repeat",
  // 820.1.c：Repeat 的格式是 “Repeat [Cost]”，cost 是卡牌文本数据，
  // 不是数值型关键词参数，故 valued 为 false。
  valued: false,
  // 820.1.c.2 / 820.1.c.3 / 820.3：多个实例各自独立、可分别支付，
  // 每支付一个实例多执行一次——不能合并为单个（"sum"）也不能只算一次（"single"）。
  stacking: "separate",
  expand(input: RepeatKeywordInput): readonly Ability[] {
    const cost = input.params?.cost ?? input.cost ?? REPEAT_COST_DEFAULT;
    const instanceId = typeof input.params?.instanceId === "string" ? input.params.instanceId : undefined;
    return [
      {
        kind: "static",
        effect: {
          kind: "repeat.cost",
          appliesTo: "self",
          host: input.host.canonicalCardId,
          count: 1,
          ...(instanceId === undefined ? {} : { instanceId }),
          cost
        }
      }
    ];
  },
  ruleRefs: REPEAT_RULE_REFS
};

export default repeat as KeywordDef;
