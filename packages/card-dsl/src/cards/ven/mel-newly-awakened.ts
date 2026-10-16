import type { Ability, CardProgram, Condition } from "../../ir/index.js";

/**
 * Mel, Newly Awakened (ven-069-166) — Unit, 4 Energy + 1 Power, 4 Might, Mind,
 * Noxus/Mel/Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-069-166，逐字）：
 *   When you play me, draw 1.
 *   [Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not
 *   Empowered.)
 *   [Empowered][>] Your spells and abilities can't be countered. If a spell or
 *   ability you control would give -:rb_might: to a unit it chooses, it gives an
 *   additional -1 :rb_might:.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a / 383.4.a.1：“When you play me” 是 Play Effect；时点 card-played，
 *   filter 用契约 3.6 的符号选择器指向能力来源自身。
 * - 414.1 / 414.3：“draw 1” = effect.draw（已合入原语），抽牌者缺省为能力控制者
 *   （190.6.d 的 “you”）。
 * - 827.1 / 827.1.c.1：[Empower] 是启动能力关键词，功能等价于 “[3 Energy]：
 *   Empower me。仅当未 Empowered 时启动。”；827.1.b.1 明确来源自身不是目标。
 * - 828.1.a / 828.1.b.1：[Empowered][>] 是依赖型关键词，整段功能等价于“当我拥有
 *   Empowered 状态时，此牌获得 [Text]”。本程序把 [Text] 写成两条带 Empowered
 *   门槛的 static 能力，不平铺成无条件能力。
 * - 426.1 / 426.2：“can't be countered” 是对对手 Counter 动作的静态禁止
 *   （426.1 定义 Counter；426.2 规定只有被游戏效果指示时才能 Counter）。
 * - 479.4 / 479.4.b：“give an additional -1 :rb_might:” 是算术图层上的数值修正，
 *   按 479.4.b 在处理时锁定（snapshotting），不是 Buff 计数器（702）。
 *
 * status = judge-required（三处缺口均不近似实现）：
 * 1. keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef，
 *    827.1.c.1 的启动费用与“仅当未 Empowered 时”限制、828.1.b.1 的依赖能力都无法
 *    展开（已合入的关键词批次不含它们）；
 * 2. “Your spells and abilities can't be countered” 是静态禁止（continuous.restrict
 *    族）：封闭 GameAction 集合没有“禁止 Counter”动作，卡牌程序也没有注册进
 *    layers / chain 的入口（chain 的 canAct / Counter 校验只读取已合入的语义注册表）；
 * 3. “would give -:rb_might: … an additional -1 :rb_might:” 需要“修正正在发生的
 *    Might 减量”的持续效果消费方：契约 3.6 的封闭 GameAction 集合没有 Might 修改
 *    动作，effects/instructions/ 下也没有 continuous.might / 数值修正原语。
 * 依赖新的 Empower/Empowered 关键词任务、RIFT-87（条件/谓词）、RIFT-89（chain 校验
 * 接线）与 RIFT-91（layers 接线）。“When you play me, draw 1” 半段用已合入的
 * effect.draw 真实执行（golden）。
 */

/** 442.1.a / 828.1.c：Empowered 门槛（描述性谓词，见 judgeReason）。 */
const empoweredGate: Condition = {
  kind: "compare",
  left: { kind: "object-property", object: "self", property: "empoweredCount" },
  operator: "gte",
  right: { kind: "constant", value: 1 }
};

const abilities: Ability[] = [
  {
    // 383.4.a：Play Effect；414.1/414.3 的 draw 1 由此触发执行。
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "mel-newly-awakened.draw-1",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  },
  {
    // 印刷费 3 Energy 见 judgeReason；KeywordAbility 没有承载印刷费用的字段。
    kind: "keyword",
    keyword: "empower"
  },
  {
    // [Empowered][>]「Your spells and abilities can't be countered」（426.1/426.2）。
    kind: "static",
    effect: {
      kind: "continuous.restrict",
      mode: "cannot-be-countered",
      appliesTo: "controller-spells-and-abilities"
    },
    condition: empoweredGate
  },
  {
    // [Empowered][>]「… would give -:rb_might: … an additional -1 :rb_might:」：
    // 479.4.b 的算术修正叠加；字段是描述性声明（见 judgeReason 第 3 条）。
    kind: "static",
    effect: {
      kind: "continuous.modify-might-reduction",
      mode: "additional",
      amount: { kind: "constant", value: -1 },
      appliesTo: "controller-spells-and-abilities"
    },
    condition: empoweredGate
  }
];

export default {
  canonicalCardId: "card.hash-881035c8e14e8d3c7fa7299235e42c62bb45a5ba4a64f90a6f663abf348954cb",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1) keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef：827.1.c.1 的" +
    "「3 Energy：Empower me，仅当未 Empowered 时启动」与 828.1.b.1 的依赖能力都无展开实现（已合入的关键词" +
    "批次不含它们，需要新的关键词任务）；(2) 「Your spells and abilities can't be countered」是 426.1/426.2" +
    " 的静态禁止（continuous.restrict 族）：封闭 GameAction 集合没有“禁止 Counter”动作，卡牌程序也没有" +
    "注册进 layers / chain 的入口（chain 的 Counter 校验只读取已合入的语义注册表），依赖 RIFT-89 的校验接线；" +
    "(3) 「would give -:rb_might: … gives an additional -1 :rb_might:」需要对正在发生的 Might 减量做叠加修正，" +
    "契约 3.6 的封闭 GameAction 集合没有 Might 修改动作、effects/instructions/ 下也没有 continuous.might 原语，" +
    "依赖 RIFT-91（layers 接线）与 442.1.a/828.1.c 的 Empowered 谓词。" +
    "“When you play me, draw 1” 半段用已合入的 effect.draw 真实执行；不近似实现（不把禁止写成假校验、" +
    "不把 -1 :rb_might: 叠加写成 effect.buff）。",
  abilities,
  sourceText:
    "When you play me, draw 1.\n" +
    "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] Your spells and abilities can't be countered. If a spell or ability you " +
    "control would give -:rb_might: to a unit it chooses, it gives an additional -1 :rb_might:."
} satisfies CardProgram;
