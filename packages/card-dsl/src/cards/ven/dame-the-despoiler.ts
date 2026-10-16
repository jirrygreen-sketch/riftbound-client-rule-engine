import type { Ability, CardProgram, Condition, Instruction } from "../../ir/index.js";

/**
 * Dame the Despoiler (ven-079-166) — Unit, 5 Energy, 5 Might, Body, Noxus
 * （无印刷 Power）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-079-166，逐字）：
 *   [Empower] :rb_energy_5::rb_rune_body: (:rb_energy_5::rb_rune_body:: Empower
 *   me. Use only if not Empowered.)
 *   [Empowered][>] When I attack or defend, choose a unit here. Increase my Might
 *   to its Might this turn, then give me +1 :rb_might: this turn.
 *
 * 规则依据（CR v1.5）：
 * - 827.1 / 827.1.c.1：[Empower] 是启动能力关键词，功能等价于“[5 Energy + 1 Body
 *   Power]：Empower me。仅当未 Empowered 时启动。”；827.1.b.1 明确来源自身不是目标。
 * - 828.1.a / 828.1.b.1：[Empowered][>] 是依赖型关键词，整段功能等价于“当我拥有
 *   Empowered 状态时，此牌获得 [Text]”。
 * - 383.4.e / 383.4.f：Attack Trigger 与 Defend Trigger；单位取得 Attacker /
 *   Defender 身份后作为 Pending Item 入链，对应封闭时点 attack-declared /
 *   defense-declared。原文的 “or” 并列两个触发条件，因此写成两条独立的 triggered
 *   能力（与 sfd-057-221 Irelia, Fervent 的 “choose or ready” 同形）。
 * - 355.7 / 355.9.a.1 / 355.9.b：“choose a unit here” 是选择目标：单位指 Board 上的
 *   单位，“here” 是位置限制（与来源同一地点），因此写成 TargetSpec（355.10.d 的
 *   无选择例外不适用，玩家要在多个单位中作选择）。
 * - 143.2.a / 479.4.b：“Increase my Might to its Might this turn” 是算术图层的
 *   “set” 修正（143.2.a.1 的官方例子正是该措辞），且因不是被动能力而在处理时锁定
 *   （479.4.b snapshotting）；随后的 “+1 :rb_might: this turn” 是同层的加值修正。
 *
 * status = judge-required（四处缺口均不近似实现）：
 * 1. keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef：
 *    827.1.c.1 的启动费用与“仅当未 Empowered 时启动”限制、828.1.b.1 的依赖能力都
 *    无法展开；契约 3.8.3 的 `params.cost` 只加在 KeywordDef.expand 的输入上，
 *    KeywordAbility 没有承载印刷费用的字段，印刷费用只记录在注释与 judgeReason 里，
 *    不伪造第二条启动能力；
 * 2. 没有 Empowered 状态谓词（442.1.a），828.1.c 的门槛不可求值；
 * 3. “Increase my Might to its Might this turn” 与 “+1 :rb_might: this turn” 需要
 *    卡牌侧 continuous.might 的注册/求值入口与 set 模式（479.4.b 的锁定语义）；契约
 *    3.6 的封闭 GameAction 集合没有 Might 修改动作，effects/instructions/ 下没有该 op，
 *    RIFT-91 只合入了 layers 引擎；
 * 4. 攻击 / 防守触发的时点已定义（attack-declared / defense-declared），但没有已合入
 *    消费方把 CardProgram 的 triggered 能力注册成事件订阅（RIFT-120），combat/ 的派出
 *    路径也尚未接入该管线。
 * 依赖：新的 Empower/Empowered 关键词任务、RIFT-87、RIFT-89/RIFT-91 与 RIFT-120。
 */

/** 442.1.a / 828.1.c：Empowered 门槛（描述性谓词，见 judgeReason）。 */
const empoweredGate: Condition = {
  kind: "compare",
  left: { kind: "object-property", object: "self", property: "empoweredCount" },
  operator: "gte",
  right: { kind: "constant", value: 1 }
};

/** “choose a unit here”：355.9 的目标选择（here = 与来源同一地点）。 */
const chosenUnitId = "dame-the-despoiler.unit-here";

/** 两条战斗触发共用的印文效果：“choose a unit here. Increase my Might to its
 *  Might this turn, then give me +1 :rb_might: this turn.” */
const combatBody = (prefix: string): readonly Instruction[] => [
  {
    // 355.7 / 355.9.b：“choose a unit here” 指定目标，因此在指令上声明 TargetSpec。
    id: `${prefix}.set-might`,
    op: "continuous.might",
    args: {
      mode: { kind: "constant", value: "set" },
      // 143.2.a.1 / 479.4.b：把 “my Might” 增加到所选单位当前的 Might。
      value: { kind: "object-property", object: { target: chosenUnitId }, property: "might" },
      duration: { kind: "constant", value: "this-turn" },
      object: { kind: "constant", value: { kind: "source" } }
    },
    targets: [
      {
        id: chosenUnitId,
        // “a unit here”：Board 上的单位，位置与来源相同（359.3.f 的 here 指代）。
        filter: { type: "unit", zone: "board", sameLocationAs: "self" },
        min: 1,
        max: 1,
        selection: "one"
      }
    ]
  },
  {
    // “then give me +1 :rb_might: this turn”：同层加值修正，与上一条独立（359.3.e.14.b）。
    id: `${prefix}.plus-1-might`,
    op: "continuous.might",
    args: {
      mode: { kind: "constant", value: "add" },
      amount: { kind: "constant", value: 1 },
      duration: { kind: "constant", value: "this-turn" },
      object: { kind: "constant", value: { kind: "source" } }
    }
  }
];

const abilities: Ability[] = [
  {
    // 印刷费 5 Energy + 1 Body Power 见 judgeReason；不伪造启动能力。
    kind: "keyword",
    keyword: "empower"
  },
  {
    // 383.4.e：“When I attack” 的 Attack Trigger。
    kind: "triggered",
    trigger: {
      at: "attack-declared",
      filter: { event: "attack-declared", filter: { source: "self" } }
    },
    optional: false,
    body: combatBody("dame-the-despoiler.attack")
  },
  {
    // 383.4.f：“or defend” 的 Defend Trigger（原文的 or 是触发条件并列）。
    kind: "triggered",
    trigger: {
      at: "defense-declared",
      filter: { event: "defense-declared", filter: { source: "self" } }
    },
    optional: false,
    body: combatBody("dame-the-despoiler.defend")
  }
];

export default {
  canonicalCardId: "card.hash-e48e6f95280cf803b6c17421f260f0c2e1b9e75ab27c4786c880d741b26084c9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口：(1) keywords/registry.generated.ts 没有 Empower / Empowered 的 KeywordDef：827.1.c.1 的" +
    "「5 Energy + 1 Body Power：Empower me，仅当未 Empowered 时启动」与 828.1.b.1 的依赖能力都无展开实现" +
    "（依赖新的 Empower/Empowered 关键词任务；KeywordAbility 没有承载印刷费用的字段，费用只记录在本文件与" +
    "本理由里）；(2) 没有 Empowered 状态谓词——442.1.a 的二元状态不在 ObjectSnapshot / Condition 里，" +
    "828.1.c 的门槛不可求值（依赖 RIFT-87）；(3) 「Increase my Might to its Might this turn」是算术图层的" +
    " set 修正（143.2.a.1、479.4.b 的锁定语义）、“then give me +1 :rb_might: this turn” 是同层加值修正：" +
    "契约 3.6 的封闭 GameAction 集合没有 Might 修改动作、effects/instructions/ 下没有 continuous.might 原语，" +
    "RIFT-91 只合入了 layers 引擎、没有 CardProgram → ContinuousEffectSpec 的接线；(4) 攻击 / 防守触发的时点" +
    "（attack-declared / defense-declared）已定义，但没有已合入消费方把 CardProgram 的 triggered 能力注册成" +
    "事件订阅（RIFT-120），combat/ 的派出路径也尚未接入该管线。不近似实现（不用 Buff 计数器代替 Might 修正，" +
    "不把 set 改成加值）。",
  abilities,
  sourceText:
    "[Empower] :rb_energy_5::rb_rune_body: (:rb_energy_5::rb_rune_body:: Empower me. Use only if not " +
    "Empowered.)\n" +
    "[Empowered][>] When I attack or defend, choose a unit here. Increase my Might to its Might " +
    "this turn, then give me +1 :rb_might: this turn."
} satisfies CardProgram;
