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
 * 当前执行边界见 judgeReason 与对应 golden；保留所有印刷语义。
 */

/** 442.1.a / 828.1.c：读取 Empower 的真实状态计数。 */
const empoweredGate: Condition = {
  kind: "compare",
  left: { kind: "object-property", object: "self", property: "empowered" },
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
    // 印刷费 3 Energy 仍待 KeywordAbility → expand params.cost 绑定。
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
    // 479.4.b 的算术修正叠加；该数值修正仍待专门消费方（见 judgeReason）。
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
  judgeReason: "当前缺口：(1) Empower.ts 的 KeywordDef 已合入，但 KeywordAbility / programs/keywords.ts 未传 params.cost，无法绑定印刷的 3 Energy（827.1.c.1）；ObjectSnapshot 契约仍未声明 empowered，参考内核已有该计数和 compare 求值。(2) continuous.restrict 的规则查询已存在，但 chain/engine.ts 的 counter 路径未查询禁止 Counter 的规则，且 programs/statics.ts 不支持 controller-spells-and-abilities 范围（426.1/426.2）。(3) continuous.modify-might-reduction 没有修改正在发生的 Might 减量的消费方，无法按 479.4.b 为选中单位追加 -1。Empowered 门槛读取真实 empowered 计数；effect.draw 已有执行证据，不近似实现。",
  abilities,
  sourceText:
    "When you play me, draw 1.\n" +
    "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] Your spells and abilities can't be countered. If a spell or ability you " +
    "control would give -:rb_might: to a unit it chooses, it gives an additional -1 :rb_might:."
} satisfies CardProgram;
