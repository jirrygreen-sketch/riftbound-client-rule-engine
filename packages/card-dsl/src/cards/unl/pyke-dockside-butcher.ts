import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Pyke, Dockside Butcher (unl-028-219) — Unit, 3 energy, no printed power,
 * Might 2, Fury, tags Pyke/Bilgewater/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-028-219，逐字）：
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for
 *   :rb_energy_0:.)
 *   [Ganking] (I can move from battlefield to battlefield.)
 *   You may pay :rb_rune_fury: as an additional cost to play me.
 *   When you play me, if you paid the additional cost, ready me and give me
 *   +2 :rb_might: this turn.
 *
 * 规则依据（CR v1.5）：
 * - [Hidden]（811.1）：可选的能力关键词，允许先以 [A] 隐藏、之后再以免费用（[0]）
 *   从面朝下区域打出（811.1.d 的面朝下区域/位置限制属该关键词展开）；卡只声明 keyword。
 * - [Ganking]（810.1.b / 144.4.c.1）：为单位的标准移动增加“战场→战场”许可；同样只声明 keyword。
 * - “You may pay :rb_rune_fury: as an additional cost to play me.”：356.2 / 356.2.b / 356.2.b.1
 *   的可选附加费用，在打出流程的 Finalize 决定并支付（355.1.a）；355.10.c 规定只在费用里出现的
 *   对象不成为目标，本条费用没有对象，只有 1 点 Fury Power。
 * - “When you play me, if you paid the additional cost, ready me and give me +2 :rb_might: this turn.”：
 *   383.4.a 的 Play Effect；383.2.a.1 把紧随触发条件的 “if you paid …” 作为触发条件的一部分，
 *   在进链前按费用回执求值（356.4.f.1：可选附加费用只看玩家是否做出支付决定）。
 *   “ready me”（416.1 / 355.10.g）走 effect.ready 的缺省来源选择器；“give me +2 :rb_might: this turn”
 *   是本回合到期的临时 Might 修正（143.2.a / 475 / 478），属 layers 的 continuous.might，
 *   effect.buff（702 的 Buff 计数器）不可代替；两者都是“me”的自我指称，355.10.g 明确不是目标，
 *   因此都不写 TargetSpec（用 TargetSpec 会错误登记“成为目标”与目标税）。
 *
 * 2026-10-17 复核：仍为 judge-required，当前缺口见 judgeReason。
 * 已有原语、关键词定义或通用适配器不代表本卡完整生产路径可执行。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "hidden" },
  { kind: "keyword", keyword: "ganking" },
  {
    kind: "play",
    // 356.2.b / 356.2.b.1："as an additional cost" + "may" = 可选附加费用（Optional Additional Cost）；
    // 本卡印刷没有 Power 费用（catalog power: null，不是 0），这是独立可选组件。
    cost: {
      id: "pyke-dockside-butcher.additional-cost",
      kind: "additional-cost",
      optional: true,
      power: { kind: "constant", value: ["Fury"] }
    },
    // 费用本身不产生结算指令；效果在下面的 Play Effect 里。
    body: []
  },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      // 383.4.a.1：“When you play me” 的 Play Effect。
      filter: { event: "card-played", filter: { source: "self" } },
      // 383.2.a.1："if you paid the additional cost" 是触发条件的一部分。
      // 356.4.f.1：读取本卡这一项费用的支付决定；回执的生产绑定仍缺失。
      condition: {
        kind: "result",
        result: "cost.additional",
        id: "pyke-dockside-butcher.additional-cost"
      }
    },
    optional: false,
    body: [
      {
        // “ready me”：effect.ready 的缺省选择器是能力来源（355.10.g），不是目标。
        id: "pyke-dockside-butcher.ready-self",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      },
      {
        // “give me +2 :rb_might: this turn.” —— 本回合到期的临时 Might 修正
        // （arithmetic 层，见 judgeReason）；不是 Buff 计数器。
        id: "pyke-dockside-butcher.grant-might-2",
        op: "continuous.might",
        args: {
          amount: { kind: "constant", value: 2 },
          duration: { kind: "constant", value: "this-turn" },
          // "me" 是自我指称（355.10.g），不是目标：合并原语的选择符经 objects
          // 指向能力来源自身（契约 3.6 的 ObjectSelector；layer 固定为 arithmetic）。
          objects: { kind: "constant", value: { kind: "source" } }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-29fe440bf64648cf3c6845485b73efbd8c2cae11e1cf26c7b3bb6a355351ebae",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺 Hidden 的 cost.hidden 到 Hide/面朝下状态及免费打出的动作与位置流程（811.1.b/811.1.d）；Hidden 费用计划辅助函数已合入，不能代替该流程。" +
    "缺可选 additional cost 到 Finalize CostPlan 的翻译（356.2.b.1）：programs/play.ts 的 translateCost 仍拒绝 additional-cost/optional，未生成 optionalAdditional。" +
    "condition.result 已合入并能读取支付决定，仍缺原始打出费用回执到 card-played 触发条件的传递（356.4.f.1）。" +
    "缺 Ganking 的 continuous.movement 许可翻译与标准移动消费方（810.1.b/144.4.c.1）：关键词给 permission 字符串，movement() 查询读取 permission.routes。",
  abilities,
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Ganking] (I can move from battlefield to battlefield.)\n" +
    "You may pay :rb_rune_fury: as an additional cost to play me.\n" +
    "When you play me, if you paid the additional cost, ready me and give me +2 :rb_might: this turn."
} satisfies CardProgram;

export default program;
