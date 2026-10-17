import type { CardProgram } from "../../ir/index.js";

/**
 * Arcane Shift (sfd-200-221) — Spell, 3 energy + 1 Mind power, tags
 * Ezreal/Signature.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-200-221，逐字）:
 *   "[Action] (Play on your turn or in showdowns.)
 *    Banish a friendly unit, then its owner plays it, ignoring its cost.
 *    Deal 3 to an enemy unit at a battlefield. Banish this."
 *
 * 规则依据（CR v1.5）：
 * - "[Action]"（806）是许可类关键词：可在任意玩家回合的 Showdown 期间打出。卡只声明关键词，
 *   展开由 effects/keywords/Action.ts 负责（契约 3.7），准入判定属 chain。
 * - "Banish a friendly unit"：被点名的单位是目标（355.7；355.9.a.1 的 unit 指 Board 对象；
 *   355.9.b 要求符合限制；355.10 的例外不适用，因为这是玩家做出的选择），因此写成 TargetSpec
 *   + effect.banish（428.1 把该牌从原区域放进 Banishment，428.2 直接放入；428.2.a/.b：
 *   Banish 不是 Kill 也不是 Discard）。
 * - "then its owner plays it, ignoring its cost"："then" 是结果引用（359.3.e.14），所以
 *   play 用 linkedTo 读取 banish 的收据，从收据拿换区后的新引用（124：换区产生新的对象身份，
 *   旧的 zoneEntryId 引用失效），绝不用旧引用按 id 重绑。"its owner" 用 object-property 在
 *   结算时读取该收据对象的 owner（359.3.f.2 的 referent 检查时机即指令执行时）；打出方是
 *   所有者而不是 Pending 项控制者，所以 player 必须显式给出。"plays it" 按 420.3/420.3.a
 *   是 Limited Action，走正常打出流程。
 * - "ignoring its cost"：356.1.b/356.1.b.1 规定 "ignoring its cost" 把该牌的基础 Energy 与基础
 *   Power 费用都置零（不是 356.1.a 的 for [Cost] 替换，也不是 356.1.b.2 的单资源忽略）。
 * - "Deal 3 to an enemy unit at a battlefield"：第二个目标；"at a battlefield" 是目标限制
 *   （355.10.b 的示例说明限制本身不是第二个目标），用已合入的过滤器键 location: "battlefield"
 *   表达（layers/filter.ts 把它与快照 location.type 比较，chain 的查询路径走该匹配器；
 *   不用 TargetSpec 级的 location 字段，它按 sameLocation 只钉一个具体战场）。damage 的来源是
 *   本咒语（418.6.a），非战斗伤害（418.1.c）。
 * - "Banish this."："this" 是咒语自身，用契约 3.6 的符号选择器 "self"；由于该咒语此时已在链上，
 *   428.1 的 Banish 会把链上的它放进 Banishment。
 * - 各指令相互独立（只有 play 依赖 banish，因为 "then" 是结果引用）：伤害与 "Banish this." 不被
 *   banish 的结果约束，按 359.3.e.11/3.4 尽可能执行。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。缺口是 "ignoring its cost" 的费用改写
 * 生产者：冻结的 CostSpec 没有 ignore/替代费用字段，effect.play 明确要求 cost 参数是费用系统产出、
 * 已 Finalize 的 FinalizedCostPlan（该原语既不推导印刷费用、也不实现忽略费用规则），按印刷费用打出
 * 会是错误结算；ResolveContext 也没有把 356.1.b.1 变成费用计划的入口。该费用改写入口与
 * cost.modify / cost.pay 属仍在进行的 RIFT-261（分支未合入），卡牌程序接入打出流程属 RIFT-257。
 * 同一缺口在 Portal Rescue（ogn-102-298）按同样口径记录。
 * banish 半段、由其衍生 owner 的打出、伤害与 "Banish this." 四条指令本身都只用已合入原语，
 * golden 用真实原语执行已支持部分（含 banish 收据换区后的新引用、忽略费用计划被拒绝而非按
 * 印刷费用结算的守卫）。不近似实现。
 */
const arcaneShift = {
  canonicalCardId: "card.hash-ff9a6c1b5cc8b6c38f2be0c96b63bf7e77ad4fb2c14de333e9f0a2b2ae17ae52",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "「its owner plays it, ignoring its cost」缺已合入的费用改写生产者：CR 356.1.b/356.1.b.1 规定 " +
    "\"ignoring its cost\" 把该牌的基础 Energy 与基础 Power 费用置零（不是 356.1.a 的 for [Cost] 替换，" +
    "也不是 356.1.b.2 的单资源忽略）；冻结的 CostSpec 只有 kind/payments/energy/power/rune/discard，" +
    "没有 ignore/替代费用字段，已合入的 effect.play 又明确要求 cost 参数是费用系统产出、已 Finalize 的 " +
    "FinalizedCostPlan（它不推导印刷费用、也不实现忽略费用规则），ResolveContext 也没有把 " +
    "356.1.b.1 变成费用计划的入口，按印刷费用打出会错误结算。该忽略/替代费用入口属未合入的 RIFT-261，" +
    "卡牌程序接入打出流程属 RIFT-257。banish 半段（effect.banish，428.1/428.2）、由收据 owner 决定的打出、" +
    "Deal 3 与本咒语自我放逐（effect.banish + \"self\"）都只用已合入原语并有执行测试；" +
    "打出指令仍保持 linkedTo（359.3.e.14）与结算时读取 owner。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "action" },
    {
      kind: "play",
      body: [
        {
          // "Banish a friendly unit"（428.1/428.2）：一个由本能力控制者控制的
          // Board 单位，是目标（355.7/355.9.a.1/355.9.b）。
          id: "arcane-shift.banish-friendly-unit",
          op: "effect.banish",
          args: {
            objects: { kind: "constant", value: { target: "arcane-shift.friendly-unit" } },
            amount: { kind: "constant", value: 1 },
            linkKey: { kind: "constant", value: "banishedUnit" }
          },
          targets: [
            {
              id: "arcane-shift.friendly-unit",
              filter: { type: "unit", controller: "self" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "then its owner plays it, ignoring its cost"（359.3.e.14 / 420.3 /
          // 356.1.b.1）：新引用与 owner 都从 banish 收据读（124），cost 记录所需
          // 的费用改写（尚未有生产者，见 judgeReason）。
          id: "arcane-shift.owner-plays-it",
          op: "effect.play",
          linkedTo: "arcane-shift.banish-friendly-unit",
          args: {
            object: {
              kind: "linked-value",
              instructionId: "arcane-shift.banish-friendly-unit",
              key: "banishedUnitObject"
            },
            player: {
              kind: "object-property",
              object: { linked: "arcane-shift.banish-friendly-unit" },
              property: "owner"
            },
            cost: {
              kind: "constant",
              value: {
                kind: "cost.modify",
                base: "printed",
                ignore: ["energy", "power"],
                minimum: 0,
                finalized: false
              }
            }
          }
        },
        {
          // "Deal 3 to an enemy unit at a battlefield"：目标是该敌方单位
          // （355.9.a.1/355.9.b）；"at a battlefield" 是 location 限制
          // （355.10.b），不是第二个目标。
          id: "arcane-shift.deal-3",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 3 },
            target: { kind: "constant", value: "arcane-shift.enemy-unit" }
          },
          targets: [
            {
              id: "arcane-shift.enemy-unit",
              filter: { type: "unit", controller: "opponent", location: "battlefield" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        },
        {
          // "Banish this."：咒语自身（契约 3.6 的 "self" 选择器；请见文件头
          // 关于 "self" 与 "source" 的说明）。
          id: "arcane-shift.banish-this",
          op: "effect.banish",
          args: {
            objects: { kind: "constant", value: "self" },
            amount: { kind: "constant", value: 1 },
            linkKey: { kind: "constant", value: "selfBanished" }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Action] (Play on your turn or in showdowns.)\n" +
    "Banish a friendly unit, then its owner plays it, ignoring its cost. " +
    "Deal 3 to an enemy unit at a battlefield. Banish this."
} satisfies CardProgram;

export default arcaneShift;
