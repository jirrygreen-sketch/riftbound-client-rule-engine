import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Emperor of the Sands (sfd-197-221) — Legend, Calm/Order, tag Azir.
 * energy: null / power: null / might: null（传奇没有印刷费用与 Might；null 不是 0）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-197-221，逐字）:
 *   "Your Sand Soldiers have [Weaponmaster].\n"
 *   ":rb_energy_1:, :rb_exhaust:: Play a 2 :rb_might: Sand Soldier unit token to your base. "
 *   "Use only if you've played an Equipment this turn."
 *
 * golden 测试真实执行 effect.token 的 sand-soldier play 形状（把不可解析的 base 占位换成
 * 控制者自己的席位）与费用计划的 energy+exhaust 收费（把宿主放在 Board 上）；两者都不是整卡证据。
 *
 * 规则依据（CR v1.5）：
 * - "Your Sand Soldiers have [Weaponmaster]." 是 364.x/365.1 的 Passive Ability：把 [Weaponmaster]
 *   授予由你控制的 Sand Soldier。按契约 3.1/3.7 写成 static 的 grant-keyword（keyword 只声明、
 *   展开归 effects/keywords/Weaponmaster.ts，卡程序不重写 821.1.c 的 Equip 减费与附着）。
 *   "Sand Soldiers" 用 187.3 的印刷名界定："A 2 [M] Sand Soldier token is a domainless unit token
 *   with 2 Might and the Shurima tag"——token 的名字是 Sand Soldier，标签是 Shurima，因此用
 *   characteristics: { name: "Sand Soldier" } 而不是 tag: "Shurima"（后者会把所有 Shurima 单位
 *   都算进来）；layers/filter.ts 与 events/pipeline-match.ts 的 characteristics 都按顶层键值
 *   比较，name 是 ObjectSnapshot 上的键。"your" 用 controller: "controller"（740.1.a）。
 * - ":rb_energy_1:, :rb_exhaust:" 是启动能力的费用（404.1.a：":" 前的费用；415.5 说明能力里的
 *   :rb_exhaust: 即 "Exhaust me"，415.4 要求该动作必须能完成）。费用形状用 CostSpec 的
 *   energy + payments[{kind: "exhaust", object: "self"}] 声明（cost/plan-values.ts 已支持），
 *   不用 effect.exhaust 的状态改变冒充费用。启动能力默认 Action 速度（在自身回合的 Open State
 *   合法时机启动）。
 * - "Play a 2 :rb_might: Sand Soldier unit token to your base."：440.2.c / 185.2.a 规定
 *   "play a … token" 先按 187.3 的 Sand Soldier 定义在链上生成，再交给 play 流程；合并的
 *   effect.token 支持 mode "play" 与 "sand-soldier" 定义（187.3：2 Might、Shurima、无费用）。
 *   "to your base" 的目的地是能力控制者自己的 Base（440.4：token 的拥有者与控制者是能力
 *   控制者）：effect.token 的原语 schema 只接受具体 LocationRef，因此按已合入的
 *   LocationExpr 桥（RIFT-357 的 "ability-controller-base"）先用 condition.value 求值，
 *   再把链接值交给原语（sfd/hunting-dog.ts、unl/carrion-dredger.ts 的同一形状）。
 * - "Use only if you've played an Equipment this turn." 是 054.2 的 "only" 使用限制：只能在满足该
 *   条件时启动。契约 3.1 把 Requirement/Restriction 与费用分开，本卡用 Restriction 声明。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - HistoryQuery 已支持 objectFilter 并可计数本回合打出的 Equipment；但 condition.history
 *   目前是 body 指令，不是启动前 Restriction 所需的 Condition/Expr（054.2）。
 * - ZoneId 没有 Legend Zone（107.4），而费用支付只接受 board/rune-zone 的横置对象；
 *   静态绑定、token 目的地与横置费用测试使用 Board 宿主，只证明各自支持的部分。
 * - programs/statics.ts 已能把原始 grant-keyword 注册进 ability 图层，并绑定相对控制者。
 *   Weaponmaster KeywordDef 已合入并展开出完整 triggered Equip 能力，但静态图层引擎对
 *   动态 triggered 能力 fail-closed（需要 lifecycle binder），权威 Equip 费用绑定也仍缺，
 *   cost.modify 不会近似折扣（821.1.c.2/c.3）。
 * 不把部分能力的执行证据当作整卡已可执行。
 */
const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      kind: "grant-keyword",
      // [Weaponmaster]（821）：只声明关键词，展开归 effects/keywords/Weaponmaster.ts。
      keyword: "weaponmaster",
      // "Your Sand Soldiers"：由你控制、印刷名为 Sand Soldier 的单位（187.3）。
      filter: {
        type: "unit",
        controller: "controller",
        zone: "board",
        characteristics: { name: "Sand Soldier" }
      }
    }
  },
  {
    kind: "activated",
    timing: "action",
    cost: {
      kind: "activated",
      // ":rb_energy_1:, :rb_exhaust:"：404.1.a 的费用；横置是费用（415.4/415.5）。
      energy: { kind: "constant", value: 1 },
      payments: [{ kind: "exhaust", object: "self" }]
    },
    // "Use only if you've played an Equipment this turn."（054.2 的 only 限制）：保留为限制声明，
    // 见 judgeReason——历史查询已合入，但尚不能作为启动前的 Condition/Expr。
    restriction: {
      kind: "use-only-if",
      value: { kind: "constant", value: "played-an-equipment-this-turn" }
    },
    body: [
      {
        // 440.4 / 355.2.a："your base" 是能力控制者的 Base；
        // LocationExpr 由解释器在运行时绑定为具体 LocationRef（RIFT-357）。
        id: "emperor-of-the-sands.controller-base",
        op: "condition.value",
        args: { value: { kind: "location", value: "ability-controller-base" } }
      },
      {
        // "Play a 2 :rb_might: Sand Soldier unit token"（187.3/440.2.c/185.2.a）。
        id: "emperor-of-the-sands.play-sand-soldier",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "sand-soldier" },
          amount: { kind: "constant", value: 1 },
          mode: { kind: "constant", value: "play" },
          // "to your base"：读取上一条指令绑定的控制者 Base 链接值；
          // effect.token 的原语 schema 接受 linked-value Expr 并自行求值。
          location: {
            kind: "linked-value",
            instructionId: "emperor-of-the-sands.controller-base",
            key: "value"
          },
          linkKey: { kind: "constant", value: "sandSoldierToken" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-956993968d114577bbdd0afa0d90d3d311a8e7b76415282b08d0cf69194c7dbf",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "（1）HistoryQuery 已支持 objectFilter 查询 Equipment 打出记录，但 condition.history 仅为 body 指令，" +
    "不能作为启动前 Restriction 的 Condition/Expr（054.2）；" +
    "（2）ZoneId 尚无 Legend Zone（CR 107.4），而费用支付只接受 board/rune-zone 的横置对象（415.4/415.5），" +
    "传奇自身无法在真实区域支付 :rb_exhaust:；" +
    "（3）Weaponmaster KeywordDef 已合入（effects/keywords/Weaponmaster.ts），展开产出完整 triggered Equip 能力，" +
    "但 KeywordGrantLayerEngine.staticEffects 对动态 triggered 能力 fail-closed（需要 lifecycle binder，" +
    "实测 judge-required），且权威 Equip 费用绑定仍缺：cost.modify 实测 CostPlanError " +
    "\"821.1.c.2 missing authoritative Equip-cost binding\"，无法计算 821.1.c.2/c.3 的准确减费。" +
    "相对控制者 Base 的 token 目的地已由 condition.value→linked-value 绑定并由 golden 真实执行，不再列为缺口。",
  abilities,
  sourceText:
    "Your Sand Soldiers have [Weaponmaster].\n" +
    ":rb_energy_1:, :rb_exhaust:: Play a 2 :rb_might: Sand Soldier unit token to your base. " +
    "Use only if you've played an Equipment this turn."
} satisfies CardProgram;

export default program;
