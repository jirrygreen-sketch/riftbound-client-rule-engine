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
 * - "Use only if you've played an Equipment this turn." 是 054.2 的 "only" 使用限制：只能在满足该
 *   条件时启动。契约 3.1 把 Requirement/Restriction 与费用分开，本卡用 Restriction 声明。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - "played an Equipment this turn" 无法判定：HistoryQuery（effects/contract.ts）只有
 *   scope/action/timingPoint/player/object 五个维度，没有按被打出卡牌的类型/标签过滤的能力，
 *   也没有"本回合打出的装备"这一谓词；卡牌 Restriction 也没有已合入的消费方（chain Finalize
 *   只检查调用方传入的 conditions），054.2 的门因此不可执行。
 * - "to your base" 的目的地无法命名：effect.token 的 location 只接受字面
 *   { type: "base", player: <PlayerId> } 且要求等于 ctx.controller，静态 IR 没有相对控制者的
 *   LocationRef 记法（effect.move 有 "controller-base"，effect.token 没有）；硬编码席位会把
 *   token 放进错误玩家的基地（同 ogn/altar-to-unity 记录的契约缺口）。
 * - 契约 3.6 的 ZoneId 没有 Legend Zone（CR 108.3）：传奇不能表示为 Board 对象，415.5/415.4 的
 *   "横置我" 费用缺少可执行宿主（费用计划只接受 board/rune-zone 上的对象，cost/payment.ts 的
 *   checkAction；同 ogn/the-boss）。
 * - 没有把 CardProgram 的 static 能力注册进 LayerEngine 的路径（同 ogn/darius-executioner），
 *   且 layers/filter.ts 的 selectorMatches 不解析 controller: "controller" 占位（按字面量比较，
 *   永不等于控制者，同 darius-executioner 记录），而 [Weaponmaster] 自身的展开
 *   （effects/keywords/Weaponmaster.ts）也标注为 judge-required
 *   （821.1.c 的 Equip 减费需要 cost.modify / cost.pay）。
 * 依赖：RIFT-89（费用计划消费方 / cost.modify）、RIFT-91（layers-continuous 静态能力注册）、
 * RIFT-120（卡程序触发/能力接线），以及 legend-zone 与相对控制者 LocationRef 的契约表达。
 * golden 测试真实执行 effect.token 的 sand-soldier play 形状（把不可解析的 base 占位换成
 * 控制者自己的席位）与费用计划的 energy+exhaust 收费（把宿主放在 Board 上）；两者都不是整卡证据。
 * 不近似实现（不按 tag Shurima 过滤，不用 effect.exhaust 冒充费用，不硬编码席位）。
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
    // 见 judgeReason——HistoryQuery 没有按类型/标签过滤"本回合打出的装备"的维度。
    restriction: {
      kind: "use-only-if",
      value: { kind: "constant", value: "played-an-equipment-this-turn" }
    },
    body: [
      {
        // "Play a 2 :rb_might: Sand Soldier unit token"（187.3/440.2.c/185.2.a）。
        id: "emperor-of-the-sands.play-sand-soldier",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "sand-soldier" },
          amount: { kind: "constant", value: 1 },
          mode: { kind: "constant", value: "play" },
          // "to your base"：静态 IR 没有相对控制者的 LocationRef 记法，保留占位；
          // 合并原语会拒绝该占位而不是把 token 放进任意席位（见 judgeReason）。
          location: {
            kind: "constant",
            value: { type: "base", player: "controller" }
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
    "（1）「Use only if you've played an Equipment this turn」不可判定：HistoryQuery（effects/contract.ts）只有 " +
    "scope/action/timingPoint/player/object 五个维度，没有按被打出卡的类型/标签过滤「本回合打出的装备」的谓词，" +
    "卡牌 Restriction 也没有已合入的消费方（chain Finalize 只检查调用方传入的 condition），054.2 的 only 门无法执行；" +
    "（2）「to your base」的目的地无法命名：effect.token 的 location 只接受字面 { type: \"base\", player: <PlayerId> } 且要求等于 " +
    "ctx.controller，静态 IR 没有相对控制者的 LocationRef 记法（effect.move 有 \"controller-base\"，effect.token 没有），硬编码席位会把 token 放进错误玩家的基地；" +
    "（3）契约 3.6 的 ZoneId 没有 Legend Zone（CR 108.3），传奇不能表示为 Board 对象，415.5/415.4 的费用式「横置我」缺少可执行宿主" +
    "（费用计划只接受 board/rune-zone 上的对象，cost/payment.ts 的 checkAction；同 ogn/the-boss）；" +
    "（4）没有把 CardProgram 的 static 能力注册进 LayerEngine 的路径（同 ogn/darius-executioner），" +
    "layers/filter.ts 的 selectorMatches 也不解析 controller: \"controller\" 占位（按字面量比较，永不等于控制者），" +
    "[Weaponmaster] 自身的展开（effects/keywords/Weaponmaster.ts）也标注 judge-required（821.1.c 的 Equip 减费需要 cost.modify / cost.pay）。" +
    "依赖：RIFT-89、RIFT-91（layers-continuous 静态能力注册）、RIFT-120（卡程序能力接线），以及 legend-zone 与相对控制者 LocationRef 的契约表达。" +
    "不近似实现（不按 tag Shurima 过滤 Sand Soldier，不用 effect.exhaust 冒充费用，不硬编码席位）。",
  abilities,
  sourceText:
    "Your Sand Soldiers have [Weaponmaster].\n" +
    ":rb_energy_1:, :rb_exhaust:: Play a 2 :rb_might: Sand Soldier unit token to your base. " +
    "Use only if you've played an Equipment this turn."
} satisfies CardProgram;

export default program;
