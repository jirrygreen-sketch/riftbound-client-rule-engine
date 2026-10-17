import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Azir, Sovereign (sfd-177-221) — Unit, Order, Bird/Azir/Shurima/Champion.
 * energy 4, power: none printed, Might 4.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-177-221，逐字）:
 *   "[Accelerate] (You may pay :rb_energy_1::rb_rune_order: as an additional cost to have me enter ready.)\n"
 *   "When I attack, you may move any number of your token units to this battlefield."
 *
 * 规则依据（CR v1.5）：
 * - [Accelerate]（805）：可选附加费用关键词；展开由已合入的
 *   effects/keywords/Accelerate.ts 负责（accelerate.cost 声明 + 805.6 入场就绪替代），
 *   卡只声明关键词，不重写展开。该印刷 power: null（无印刷力量费）——不写任何
 *   power 费用，也不把 null 改写成 0。
 * - "When I attack"：383.4.e 的 Attack Trigger（单位首次取得 Attacker 身份时触发），
 *   对应封闭时点 attack-declared（events/timing-points.ts，refs 323.2/383.4.e/466.2.c）。
 * - "you may"：403.1 规定触发式能力效果首段是 "you may" 时，由控制者决定是否执行该
 *   触发；契约 3.9 要求把被选指令包进 choice.optional 的 body（不是 choice + linkedTo）。
 *   触发级 optional: true 与之并存（403.1 的触发层决定），in-HEAD 同型卡
 *   （veiled-temple/sunken-temple/treasure-hoard）采用同一形状。
 * - "any number of your token units"：355.12/355.13——"any number"/"up to" 的选择
 *   按目标处理且可以为 0，因此写成 TargetSpec（selection: "up-to", min: 0），而不是
 *   非目标 pick；"your" 用 controller 过滤，"token units" 用 type: "token"（已合入的
 *   layers/filter.ts 与 events/pipeline-match.ts 都把 token 作为 isToken 匹配）。
 *   filter 的 controller: "controller"（= "you"）绑定也依赖同一批归一化工作：
 *   chain/engine.ts 的 query 只归一化 self/opponent。
 *   移动数量上限用 count 表达式读本次已选目标的个数（结果即"任意数量"的上界；
 *   amount 只是非负整数上界，不足时按实际可用数量执行，359.3.e.11）。
 *   effect.move 的对象选择符按契约 3.6 写符号选择器 { target: "<TargetSpec id>" }。
 * - "to this battlefield"：Move（421.1）的目的地是能力来源所在的战场（"here"，
 *   359.3.f.1 的 referent：从能力来源读取，指令执行时检查，359.3.f.2）。静态 IR 不能
 *   写运行时 ObjectRef，位置也无法用 ObjectSelector 直接表达，因此 body 先用
 *   condition.value 在结算时读出来源当前位置，再由 effect.move 的 to 经 linked-value
 *   读取（该形状被 effect.move 接受并真实执行）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required（复核 2026-10-17）。
 * - attack-declared 时点没有发射方：events/action-adapter.ts 只按已提交的游戏动作派生
 *   时点（move-location/ready/exhaust/… ），combat/flow.ts 在 combat-start 事务处显式抛
 *   TurnCombatBlockedError（角色指定尚未实现），全仓库没有 'attack-declared' 的 emit 调用，
 *   触发无法进入链（383.4.e.2 的 "进链为 Pending Item" 路径缺失）。
 * - "到本战场"的 Move 目的地读取依赖来源的当前位置（359.3.f.1）；来源已离场/换位时的
 *   回看口径由事件与时点任务确定。
 * - 卡牌程序的触发注册与打出流程绑定仍属未合入的 RIFT-257。
 * - [Accelerate] 的展开已合入（805.1.b/.b.2），但其可选附加费用在卡牌侧的收取
 *   （cost.pay / optionalAdditional 接线）仍属未合入的 RIFT-261。
 * 依赖：attack-declared 发射路径（combat 角色事务）、RIFT-257、RIFT-261。
 * 不近似实现（不把 attack 触发改成其它时点，也不手改状态）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "accelerate" },
  {
    kind: "triggered",
    trigger: {
      at: "attack-declared",
      filter: { event: "attack-declared", filter: { source: "self" } }
    },
    optional: true,
    body: [
      {
        id: "azir-sovereign.may-move-tokens",
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Move any number of your token units to this battlefield?" },
          body: {
            kind: "constant",
            value: [
              {
                id: "azir-sovereign.read-battlefield",
                op: "condition.value",
                args: {
                  value: {
                    kind: "object-property",
                    object: "source",
                    property: "location"
                  },
                  key: { kind: "constant", value: "here" }
                }
              },
              {
                id: "azir-sovereign.move-tokens",
                op: "effect.move",
                linkedTo: "azir-sovereign.read-battlefield",
                args: {
                  objects: { kind: "constant", value: { target: "azir-sovereign.token-units" } },
                  to: {
                    kind: "linked-value",
                    instructionId: "azir-sovereign.read-battlefield",
                    key: "here"
                  },
                  amount: {
                    kind: "count",
                    subject: "objects",
                    filter: { object: { target: "azir-sovereign.token-units" } }
                  },
                  linkKey: { kind: "constant", value: "moved" }
                },
                targets: [
                  {
                    id: "azir-sovereign.token-units",
                    filter: { type: "token", controller: "controller", zone: "board" },
                    min: 0,
                    selection: "up-to"
                  }
                ]
              }
            ]
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-f83c5d61c7ea4a0d2c54ba2c2a17020893a7a3b5a90d16003fe815b2b61c5c12",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "attack-declared 时点没有发射方：events/action-adapter.ts 只为已提交游戏动作派生时点，combat/flow.ts 的 " +
    "combat-start 事务仍显式阻断（contestCombat 抛 TurnCombatBlockedError，Attacker/Defender 角色指定未实现），" +
    "全仓库无 'attack-declared' 的 emit，触发无法按 383.4.e.2 进入链；Move 目的地「to this battlefield」要按 " +
    "359.3.f.1 在结算时读取来源当前位置，来源已离场时的回看口径尚未由事件/时点任务确定；卡牌程序的触发注册与" +
    "打出绑定仍属未合入的 RIFT-257；[Accelerate] 的展开已合入（805.1.b），但其可选附加费用在卡牌侧的收取" +
    "（cost.pay / Finalize 的 optionalAdditional 接线）属未合入的 RIFT-261。" +
    "依赖：attack-declared 发射路径（combat 角色事务）、RIFT-257、RIFT-261。不近似实现。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_order: as an additional cost to have me enter ready.)\n" +
    "When I attack, you may move any number of your token units to this battlefield."
} satisfies CardProgram;

export default program;
