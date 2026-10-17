import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Prodigal Explorer (sfd-199-221) — Legend, Mind/Chaos, tag Ezreal.
 * energy: null / power: null / might: null（传奇没有印刷费用与 Might；null 不是 0）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-199-221，逐字）:
 *   ":rb_exhaust:: [Reaction] — Draw 1. Use only if you've chosen enemy units and/or gear twice this turn "
 *   "with spells or unit abilities."
 *
 * 规则依据（CR v1.5）：
 * - ":rb_exhaust:" 是启动能力的费用（404.1.a：":" 前的费用：415.5 说明能力里的 :rb_exhaust: 即
 *   "Exhaust this/me"，415.4 要求该动作必须能完成）。费用形状用 CostSpec 的
 *   payments[{kind: "exhaust", object: "self"}] 声明（cost/plan-values.ts 已支持），不用
 *   effect.exhaust 的结算时状态改变冒充费用。
 * - "[Reaction]" 是 813.1 的 Permissive keyword：813.1.c.2 把它定义为"该启动能力可在任意玩家回合的
 *   Closed State 启动"，813.1.d 规定能力上的格式是 "[Reaction][>]"。IR 里由
 *   ActivatedAbility.timing = "reaction" 直接声明（同 ogn/hand-of-noxus、
 *   ogn/daughter-of-the-void），不需要额外 keyword 能力。
 * - "Draw 1." 是 effect.draw（414.1 默认从 Main Deck 顶抽、414.3 的印刷格式）；省略 player 即
 *   隐含的 "you" = 能力控制者（190.6.d）。
 * - "Use only if you've chosen enemy units and/or gear twice this turn with spells or unit abilities."
 *   是 054.2 的 "only" 使用限制：只能在满足条件时启动。契约 3.1 把 Requirement/Restriction 与费用
 *   分开（"必须满足才能打出" 与 "只能打到某处"），本卡用 restriction 声明。
 *   "chosen"（355.6/355.7）指选目标（became-target 的来源），不是非目标 pick；"twice this turn" 是
 *   本回合的计数（383.1 的 Nth-time 家族），"with spells or unit abilities" 需要把该选择归因到法术或
 *   单位能力（412.4/412.5/412.6 的责任与归因、754）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 条件不可判定：became-target 时点本身已合入（chain/engine.ts 在 Finalize 锁定时发射，target-plan.ts
 *   也有派生），但 HistoryQuery（effects/contract.ts）只有 scope/action/timingPoint/player/object/
 *   exclude/objectFilter，既不按 timingPoint 统计「本回合被选次数」的来源归因（412.4/412.6、754），
 *   也没有「该次选择来自法术还是单位能力」的维度；"and/or" 还要把"敌方单位"与"装备"两类被选对象
 *   合并计数。卡牌 Restriction 仍没有已合入适配：programs/play.ts 的 translateLegalityCondition 只接受
 *   condition 或约定 kind（always/never/compare/all/any/not/expression），本卡的 use-only-if 会以
 *   judge-required 抛错，chain Finalize 只检查调用方传入的 condition。054.2 的门因此不可执行。
 * - 契约 3.6 的 ZoneId 没有 Legend Zone（CR 108.3）：传奇不能表示为 Board 对象，415.5/415.4 的
 *   "横置我" 费用缺少可执行宿主（费用计划只接受 board/rune-zone 上的对象，cost/payment.ts 的
 *   checkAction；同 ogn/the-boss）。
 * - 没有已合入的订阅方/接线把 CardProgram 的 activated ability 推进链（启动能力 → 链的路径）、
 *   也没有把卡牌 Restriction 接进 Finalize 的路径（同 ogn/hand-of-noxus、ogs/lux-crownguard）。
 * 依赖：RIFT-89（费用计划消费方）、RIFT-90（目标/选择与 targeting 通知，752/754）、RIFT-120
 * （链与事件单管线接线），以及 legend-zone 的契约表达。
 * golden 测试用解释器 + 参考内核真实执行已合入的 effect.draw；整卡仍不可执行，不近似实现。
 */
const abilities: Ability[] = [
  {
    kind: "activated",
    // 813.1.c.2：能力上的 [Reaction] = 可在任意玩家回合的 Closed State 启动。
    timing: "reaction",
    cost: {
      kind: "activated",
      // ":rb_exhaust:"：404.1.a 的费用；415.4/415.5 要求横置作为费用必须能完成。
      payments: [{ kind: "exhaust", object: "self" }]
    },
    // "Use only if you've chosen enemy units and/or gear twice this turn with spells or unit abilities."
    // （054.2 的 only 限制）：保留为限制声明，见 judgeReason——缺少"本回合被选次数 + 选择来源归因"的读数。
    restriction: {
      kind: "use-only-if",
      value: {
        kind: "constant",
        value: "chosen-enemy-units-or-gear-twice-this-turn-with-spells-or-unit-abilities"
      }
    },
    body: [
      {
        // "Draw 1."（414.3）：缺省抽牌者即能力控制者（190.6.d）。
        id: "prodigal-explorer.draw-1",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-0f2d2889821a45fbe61cc42c0f59fd9c445a9a0a9cab9d8af29603770ea28aff",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "（1）限制条件不可判定：「you've chosen enemy units and/or gear twice this turn with spells or unit abilities」需要" +
    "本回合 355.6/355.7 的「被选」事件计数与选择来源归因（412.4/412.6、754）。became-target 时点已合入" +
    "（chain/engine.ts Finalize 锁定与 target-plan.ts 派生），但 HistoryQuery（effects/contract.ts）只有 " +
    "scope/action/timingPoint/player/object/exclude/objectFilter，没有按 timingPoint 计数的「被选次数」读法，" +
    "也没有「法术 / 单位能力」的来源归因维度；「and/or」还要合并敌方单位与装备两类被选对象。" +
    "（2）卡牌 Restriction 没有适配：programs/play.ts 的 translateLegalityCondition 只接受 condition 或约定 kind" +
    "（always/never/compare/all/any/not/expression），本卡的 kind \"use-only-if\" + value 会被 fail-closed 以 " +
    "judge-required 拒绝，chain Finalize 也只检查调用方传入的 condition，054.2 的 only 门无法执行。" +
    "（3）契约 3.6 的 ZoneId（hand/deck/rune-deck/trash/banishment/board/rune-zone/chain）没有 Legend Zone（CR 108.3），" +
    "415.5/415.4 的费用式「横置我」缺少可执行宿主：费用计划只接受 board/rune-zone 上的对象（cost/payment.ts 的 checkAction；同 ogn/the-boss）。" +
    "（4）[Reaction] 启动许可（813.1.c.2）本身可由 programs/activate.ts 声明为 ChainDraft.speed，但 chain.canAct 只读自身状态、" +
    "不读 continuous.timing 图层许可（RIFT-259 的 layers/rules 查询尚无 chain 消费方），传奇的费用宿主也使实际启动不成立。" +
    "依赖：RIFT-90/后续（被选次数与选择来源归因的 history 维度）、RIFT-259/257 后续（canAct 读取图层许可），" +
    "以及 legend-zone 的契约表达。effect.draw 与「横置我」的 CostSpec 形状已合入，golden 真实执行；" +
    "不近似实现（不用 effect.exhaust 冒充费用，不把条件近似成某个可读计数）。",
  abilities,
  sourceText:
    ":rb_exhaust:: [Reaction] — Draw 1. Use only if you've chosen enemy units and/or gear twice this turn " +
    "with spells or unit abilities."
} satisfies CardProgram;

export default program;
