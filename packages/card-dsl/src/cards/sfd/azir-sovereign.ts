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
 * 当前复核：保持 judge-required；具体未接通路径见 judgeReason。
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
    "attack-declared 缺真实 combat 角色事务生产者（383.4.e.2/466.2.c）：启动一场已 Staged 的战斗仍由 combat/flow.ts 的 combat-start-transaction 阻断（\"Combat start needs an atomic simultaneous timing wave + roles\"），没有已合入模块为“取得 Attacker 身份”发该时点；只有注入式 emit 才能在测试里验证触发体。" +
    "Accelerate 的费用绑定未接通：accelerate.cost 是 static ContinuousEffect，programs/statics.ts 的 layerFor 对未知 kind 直接 judgeRequired（\"Static ability kind accelerate.cost has no layer mapping\"），" +
    "programs/play.ts 的 translateCost 也拒绝 additional-cost/additional 字段，因此该声明进不了 Finalize 的 optionalAdditional，805.2.b/805.6.a 的入场替代也没有支付决定门控，不能免费就绪或入场后再 ready。" +
    "可选 body 内的 token TargetSpec 仍被 chain/engine.ts 的 assertFinalizationSurface 主动阻断（\"Nested/repeated targets require an interpreter target-selection lifecycle adapter\"）；Finalize 只收集顶层目标，不能在 Resolve 重新选目标。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_order: as an additional cost to have me enter ready.)\n" +
    "When I attack, you may move any number of your token units to this battlefield."
} satisfies CardProgram;

export default program;
