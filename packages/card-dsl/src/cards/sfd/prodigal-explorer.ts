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
 *   是 054.2 的 "only" 使用限制；377.2.b 规定"使用"条件必须在启动前为真
 *   （该抽象属 Triggered/Replacement/Passive 的 386 家族，不能借用）。
 *   契约 3.1 把 Requirement/Restriction 与费用分开（"必须满足才能打出" 与 "只能打到某处"），
 *   本卡用 restriction 声明。
 *   "chosen"（355.6/355.7）指选目标（became-target 的来源），不是非目标 pick；"twice this turn" 是
 *   本回合的计数（383.1 的 Nth-time 家族），"with spells or unit abilities" 需要把该选择归因到法术或
 *   单位能力（412.4/412.5/412.6 的责任与归因、754）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required（2026-10-17 实测复核）。
 * - 条件不可判定：became-target 时点本身已合入（chain/engine.ts 在 Finalize 锁定时发射，target-plan.ts
 *   也有派生），但 HistoryQuery（effects/contract.ts 的 scope/action/timingPoint/player/object/
 *   exclude/objectFilter）只统计已提交的 GameAction：TestWorld 在 perform 成功后把动作入账，
 *   became-target 是链在 Finalize 发射的时点而非 game action，查不到；生产 ResolveContext
 *   （apps/game-server/src/engine-runtime/host.ts）的 history 更是恒定返回 0。
 *   即使能读到计数，也仍缺「该次选择来自法术还是单位能力」的来源归因维度（412.4/412.5/412.6、754），
 *   以及把"敌方单位"与"装备"两类被选对象合并计数的 "and/or" 形状。
 * - 卡牌 Restriction 仍没有已合入适配：programs/play.ts 的 translateLegalityCondition 只接受
 *   condition 或约定 kind（always/never/compare/all/any/not/expression），
 *   programs/activate.ts 的 translateRestriction 对本卡的 use-only-if 实测 fail-closed 抛
 *   "restriction ... kind use-only-if needs a rules adapter"；chain Finalize 只检查调用方传入的 condition。
 *   054.2 的门因此不可执行。
 * - 契约 3.6 的 ZoneId 没有 Legend Zone（CR 107.4；108.3 是 Champion Zone）：传奇不能表示为 Board 对象，415.5/415.4 的
 *   "横置我" 费用缺少可执行宿主（费用计划只接受 board/rune-zone 上的对象，cost/payment.ts 的
 *   checkAction；同 ogn/the-boss）。
 * - 启动能力 → 链的生产接线已合入（programs/activate.ts describeActivate；服务端 runtime 的 activate
 *   命令），scenario 测试台也走 describeActivate + ChainEngine；但服务端在启动前就调用
 *   assertCanControl，且传奇在 game/lifecycle.ts 里仍建在 chain 上，实际启动不成立。
 * 依赖：被选次数与选择来源归因的 history 维度、Restriction 适配（含 use-only-if 的类型化条件），
 * 以及 legend-zone 的契约表达。
 * 参数化 golden（test/cards/templates/activated-activated-effect-draw-689.test.mjs）经真实链执行
 * 已合入的 exhaust 费用 + effect.draw 两半；整卡仍不可执行，不近似实现。
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
    "本回合 355.6/355.7 的「被选」事件计数与选择来源归因（412.4/412.5/412.6、754）。became-target 时点已合入" +
    "（chain/engine.ts Finalize 锁定与 target-plan.ts 派生），但 HistoryQuery（effects/contract.ts）只有 " +
    "scope/action/timingPoint/player/object/exclude/objectFilter，且只统计已提交的 GameAction（参数化 golden 内核在 perform 成功后入账）：" +
    "became-target 是链在 Finalize 发射的时点、不是 game action，读不到该计数；" +
    "生产 ResolveContext（apps/game-server/src/engine-runtime/host.ts）的 history 恒定返回 0。" +
    "即使计数可读，也仍缺「法术 / 单位能力」的来源归因维度；「and/or」还要合并敌方单位与装备两类被选对象。" +
    "（2）卡牌 Restriction 没有适配：programs/play.ts 的 translateLegalityCondition 只接受 condition 或约定 kind" +
    "（always/never/compare/all/any/not/expression），本卡的 kind \"use-only-if\" + value 经 programs/activate.ts 的 " +
    "translateRestriction 实测抛 \"restriction ... kind use-only-if needs a rules adapter\"，" +
    "chain Finalize 也只检查调用方传入的 condition，054.2 的 only 门无法执行。" +
    "（3）契约 3.6 的 ZoneId（hand/deck/rune-deck/trash/banishment/board/rune-zone/chain）没有 Legend Zone（CR 107.4），" +
    "415.5/415.4 的费用式「横置我」缺少可执行宿主：费用计划只接受 board/rune-zone 上的对象（cost/payment.ts 的 checkAction；同 ogn/the-boss）。" +
    "（4）[Reaction] 启动许可（813.1.c.2）可由 programs/activate.ts 声明为 ChainDraft.speed，chain.canAct 也已读取 " +
    "actionTimings 合并的 continuous.timing 图层许可（chain/engine.ts）；但服务端在启动前调用 assertCanControl，" +
    "且 game/lifecycle.ts 仍把传奇建在 chain 上，费用宿主（Legend Zone）不成立。" +
    "依赖：被选次数与选择来源归因的 history 维度、" +
    "Restriction 适配（含 use-only-if 的类型化条件），以及 legend-zone 的契约表达。" +
    "effect.draw 与「横置我」的 CostSpec 形状已合入，RIFT-689 参数化 golden 经真实链执行；" +
    "不近似实现（不用 effect.exhaust 冒充费用，不把条件近似成某个可读计数）。",
  abilities,
  sourceText:
    ":rb_exhaust:: [Reaction] — Draw 1. Use only if you've chosen enemy units and/or gear twice this turn " +
    "with spells or unit abilities."
} satisfies CardProgram;

export default program;
