import type { Ability, CardProgram, Instruction } from "../../ir/index.js";

/**
 * Forgotten Relic (ven-108-166) — Gear, 5 Energy, no printed Power, no Might,
 * Chaos, no tags.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-108-166，逐字）：
 *   "When you play this or at the start of your Beginning Phase, [Burn 1].
 *    When you burn a unit this way, do this: Give a friendly unit +:rb_might:
 *    equal to the burned card's Might this turn.
 *    (To Burn 1, put the top card of your Main Deck into your trash.)"
 *
 * 规则依据（Core Rules v1.5）：
 * - 383.4.a / 383.4.a.1：Play Effect（"When you play this"）是触发能力，打出后进入链
 *   作为 Pending Item；封闭时点 card-played。
 * - 315.2.a.1：Beginning Phase 的开始步骤，对应封闭时点 beginning-start；190.6.d：
 *   "your" 指该能力控制者。
 * - 441.1 / 441.2 / 441.2.a / 441.4："[Burn 1]" 把主牌库顶 1 张牌移入弃牌区；
 *   括号内文字是 Burn 动作的固定说明，不是第二条能力；作为效果必须尽可能多地烧。
 * - 441.1.a："When you burn" 触发在烧牌发生之后结算；本卡把"当你以这种方式烧掉一个单位"
 *   写成一个反身触发（Reflexive Trigger）。
 * - 388.1 / 388.2 / 389.1 / 389.2："do this:" 是 Reflexive Trigger 的识别标志；
 *   它在条件成立时新建一个链项（Pending Item），其选择在该反身链项 finalize 时才做
 *   （355.5.b 明确 Reflexive Triggers 的选择不在原链项 finalize 时进行）。
 * - 359.3.e.13：烧掉的牌离开主牌库后成为新对象（124），"the burned card's Might"
 *   只能经最后已知信息回看；没有可用最后已知信息时该指令被忽略，不把 null 当 0
 *   （契约：energy:null/power:null/might:null 不是 0）。
 * - "Give a friendly unit +:rb_might: … this turn"：临时 Might 修正属 layers 的
 *   continuous.might，按 317.2.c 在本回合结束时同时到期（433.1.a 的算术层调制）；
 *   effect.buff 的文件头明确临时 Might 修正不属于 Buff 计数器（702）。
 *
 * status = judge-required（缺口均不近似实现）：
 * 1. 缺反身触发原语：契约 3.1 的六种 Ability 与已合入指令注册表都没有创建 Reflexive
 *    Pending Item 的形态（388.1/389.1/355.5.b；调研 RIFT-9 记名为 trigger.reflexive，
 *    docs/plans/survey/unclassified-unl.md 的该行正以本卡为例）；且反身链项内的目标
 *    选择被 chain/engine.ts 的 assertFinalizationSurface 阻断（"Nested/repeated targets
 *    require an interpreter target-selection lifecycle adapter"）。
 * 2. 缺"以这种方式烧掉一个单位"的结果条件与绑定：441.1.a 的 burn 事件门（烧掉的牌是
 *    单位）与 "the burned card" 的引用绑定需要条件/结果绑定原语（调研 RIFT-9 的
 *    condition.result："If you do / Paid / This way"，未合入）；卡牌程序没有任何通道
 *    读取所执行的烧牌结果。
 * 3. 缺临时 Might 修正的指令原语：effects/instructions 下没有任何已注册 op 通过
 *    ResolveContext.addContinuous 注册 continuous.might（同 ogn/gentlemens-duel 的判定），
 *    契约 3.6 的封闭 GameAction 集合也没有 Might 修改动作。
 * 4. 没有任何已合入订阅方把 CardProgram 的 triggered ability 注册成 TriggerRegistration
 *    （契约 3.5），card-played / beginning-start / card-burned 也缺生产链接线。
 * 可执行部分：effect.mill 的 Burn 1 本体（441.1/441.2/441.4，含牌库不足只烧得到的部分）
 * 由 golden 用真实解释器执行；被替代时整条 negated。不近似实现缺失的三块。
 * 依赖：trigger.reflexive 与 condition.result 原语（RIFT-9 清单）、continuous.might 指令
 * 原语（RIFT-91 求值侧已合入，缺卡牌侧入口）、契约 3.5 的卡牌触发注册接线。
 */
// 反身触发把被烧的牌写进该链接键，本体按契约 3.6 的 { linked } 选择器读取它
// （命名结果记录按写入顺序展开对象绑定）。
const BURNED_CARD_LINK = "forgotten-relic.burned-card";

/** 反身触发的本体：给出与"被烧的牌"Might 相等的临时 Might 修正。 */
const giveMightToFriendlyUnit: Instruction = {
  id: "forgotten-relic.give-might",
  // "Give a friendly unit +:rb_might: equal to the burned card's Might this turn." —
  // 金额在结算时读取被烧牌的最后已知 Might（359.3.e.13）；无可用信息时整条指令忽略，
  // 绝不把 null 变成 0。此 op 尚无已注册实现（见 judgeReason 第 3 条）。
  op: "continuous.might",
  args: {
    amount: {
      kind: "object-property",
      object: { linked: BURNED_CARD_LINK },
      property: "might"
    },
    duration: { kind: "constant", value: "end-of-turn" },
    target: { kind: "constant", value: "forgotten-relic.friendly-unit" }
  },
  targets: [
    {
      id: "forgotten-relic.friendly-unit",
      // "a friendly unit"（190.6.d 的隐含 "you" = 能力控制者）：一个友方单位，是 Target
      // （355.7/355.10.a）；该选择属于反身链项 finalize（355.5.b）。
      filter: { type: "unit", controller: "self", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]
};

/**
 * 一条 Burn 1 + 其后反身触发的组合；两个触发来源（打出 / Beginning Phase 开始）
 * 共用同一形状，但指令 id 各自独立，链接值也各自独立。
 */
function burnThenReflexive(suffix: string): readonly Instruction[] {
  const burnId = `forgotten-relic.burn-${suffix}`;
  return [
    {
      id: burnId,
      // "[Burn 1]" — 441.1/441.2/441.4；441.4 的牌库不足由原语按尽可能多处理。
      op: "effect.mill",
      args: { amount: { kind: "constant", value: 1 } }
    },
    {
      id: `forgotten-relic.reflexive-${suffix}`,
      // "When you burn a unit this way, do this:" — 388.1/389.1 的反身触发；链项在烧牌
      // 之后按条件新建，选择在反身链项 finalize 时进行（355.5.b）。已合入的指令注册表
      // 没有该 op（调研记名 trigger.reflexive），故如实记录形状而不执行（见 judgeReason）。
      op: "trigger.reflexive",
      args: {
        at: { kind: "constant", value: "card-burned" },
        // "a unit" + "this way"：只对本次 Burn 实际烧掉的单位成立；绑定由结果条件原语
        // （condition.result）提供，当前不存在（见 judgeReason 第 2 条）。
        filter: { kind: "constant", value: { event: "card-burned", type: "unit" } },
        condition: {
          kind: "constant",
          value: {
            kind: "expression",
            value: { kind: "constant", value: "burned-by-this-instruction" }
          }
        },
        // 被烧的牌（441.1.a / 359.3.e.13 的回看）写进链接值，供本体读取其 Might。
        burned: {
          kind: "linked-value",
          instructionId: burnId,
          key: "burnedCard"
        },
        link: { kind: "constant", value: BURNED_CARD_LINK },
        body: { kind: "constant", value: [giveMightToFriendlyUnit] }
      }
    }
  ];
}

const abilities: Ability[] = [
  {
    kind: "triggered",
    // "When you play this" — Play Effect（383.4.a/383.4.a.1），打出后入链。
    trigger: { at: "card-played", filter: { event: "card-played", filter: { source: "self" } } },
    optional: false,
    body: burnThenReflexive("on-play")
  },
  {
    kind: "triggered",
    // "at the start of your Beginning Phase" — 315.2.a.1 的开始步骤；"your" = 能力控制者
    // （190.6.d），用 190.6.d 的 player 选择子拼写。
    trigger: { at: "beginning-start", filter: { event: "beginning-start", player: "self" } },
    optional: false,
    body: burnThenReflexive("at-beginning")
  }
];

export default {
  canonicalCardId: "card.hash-15ff48d601dbbf88a4e20335d5fed2db90642596b505780338ee6d79f6623847",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口，均不近似实现：(1) 「When you burn a unit this way, do this:」是反身触发（388.1/388.2/389.1/389.2；" +
    "选择在反身链项 finalize 时进行，355.5.b），而契约 3.1 的六种 Ability 与已合入指令注册表都没有创建 Reflexive " +
    "Pending Item 的形态（调研 RIFT-9 记名 trigger.reflexive，docs/plans/survey/unclassified-unl.md 该行正以本卡为例）；" +
    "反身链项内的目标选择也被 chain/engine.ts 的 assertFinalizationSurface 阻断" +
    "（\"Nested/repeated targets require an interpreter target-selection lifecycle adapter\"）。" +
    "(2) 「burn a unit this way」的门与「the burned card」的绑定需要结果条件原语：441.1.a 的 burn 事件要由烧牌结果判断" +
    "被烧的牌是否为单位，并把该引用带入本体（调研 RIFT-9 的 condition.result：「If you do / Paid / This way」，未合入）；" +
    "卡牌程序没有读取所执行烧牌结果的通道。" +
    "(3) 「Give a friendly unit +:rb_might: equal to the burned card's Might this turn」是 317.2.c 到期的 " +
    "continuous.might 临时 Might 修正（433.1.a；effect.buff 文件头明确临时 Might 不入 Buff 计数器，CR 702），" +
    "effects/instructions 下没有任何已注册 op 通过 ResolveContext.addContinuous 注册它（RIFT-91 求值侧已合入，缺卡牌侧入口）。" +
    "(4) 没有已合入订阅方把 CardProgram 的 triggered ability 注册成 TriggerRegistration（契约 3.5），" +
    "card-played / beginning-start / card-burned 时点的生产链接线同样缺失。" +
    "可执行部分：effect.mill 的 Burn 1 本体（441.1/441.2/441.4，牌库不足只烧得到的部分；被替代时 negated）由 golden " +
    "用真实解释器执行。依赖：trigger.reflexive 与 condition.result 原语、continuous.might 指令原语、契约 3.5 触发注册接线。",
  abilities,
  sourceText:
    "When you play this or at the start of your Beginning Phase, [Burn 1]. " +
    "When you burn a unit this way, do this: Give a friendly unit +:rb_might: equal to the burned card's Might this turn. " +
    "(To Burn 1, put the top card of your Main Deck into your trash.)"
} satisfies CardProgram;
