import type { CardProgram } from "../../ir/index.js";

/**
 * Renekton, Rage Fueled (ven-019-166) — Unit, 6 Energy（无印刷 Power），6 Might,
 * Fury, Shurima/Renekton/Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-019-166，逐字）：
 *   [Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to
 *   have me enter ready.)
 *   When I attack, if you control 4 or fewer runes, deal 2 to all enemy units here.
 *
 * 规则依据（CR v1.5）：
 * - 805.1.b / 805.2 / 805.5：[Accelerate] 是 Optional Additional Cost 关键词，
 *   费用固定 [1] + 一个与单位域匹配的 Power（805.1.b.1，本卡为 Fury），按契约 3.7 只声明
 *   `{ kind: "keyword", keyword: "accelerate" }`（不带数值），展开由已合入的
 *   effects/keywords/Accelerate.ts 提供（accelerate.cost 声明 + 805.6 的入场就绪替代）。
 *   本卡 power: null 表示无印刷 Power 费——不写成 0、也不动它。
 * - 383.4.e / 383.4.e.1 / 383.4.e.2.a："When I attack" 是 Attack Trigger，时点为
 *   events/timing-points.ts 的封闭时点 "attack-declared"；该时点每个战斗只检查一次触发
 *   条件，故记 once: "per-combat"（与已合入的 sfd/ahri-inquisitive 同写法）。
 * - 383.2.a.1：紧跟触发条件的 "if you control 4 or fewer runes" 属于 Trigger Condition
 *   本身（触发时判定），因此写在 TriggerSpec.condition，而不是 body 指令上；
 *   133.5.a.1 / 431.1 中已 channel 的 Rune 位于控制者的 rune zone。
 * - 418.1.b/418.1.c/418.1.d：“deal 2 to all enemy units here” 是对**按特征选出的整组**
 *   单位造成伤害；355.10.d/355.10.d.1 规定这类玩家无从选择的集合不是目标，因此不写
 *   TargetSpec（写了会错误触发“成为目标”，355.7/754），只保留非目标集合描述符。
 *   "here" 是来源当前所在地点（053 的指称、359.3.f 的 referent 语义）。
 *
 * status = judge-required（三处依赖均不近似实现）：
 * 1. 非目标集合的伤害形态缺失：已合入的 effect.damage 只经 ctx.targets(TargetSpec id)
 *    读受击集合，没有 effect.ready / effect.heal 那样的 { kind: "query", filter } 分支，
 *    因此“all enemy units here”不可执行；用 TargetSpec 近似会错误触发成为目标。
 * 2. attack-declared 时点没有发射方：combat/ 批次尚未把取得 Attacker 身份接入事件管线
 *    （combat/flow.ts 对战斗开始显式抛 TurnCombatBlockedError；全仓库没有 attack-declared
 *    的 emit 调用），触发无法进入链；CardProgram → TriggerRegistration 的通用路径已合入。
 * 3. [Accelerate] 的展开与 cost-planner 词汇虽已合入，但没有任何生产方把卡牌上的
 *    keyword 能力接进打出流程：cost/cost-plan.ts 只消费调用方传入的 optionalAdditional，
 *    没有从 accelerate.cost 静态效果生成费用组件的路径（同上批 sfd/blazing-scorcher 的
 *    判定）。
 * “if you control 4 or fewer runes” 这一 Trigger Condition 是真实可求值的：模板 golden 用
 * 测试台真实计数（4 runes 触发 / 5 runes 不触发，383.4.e.2.b）。
 */
export default {
  canonicalCardId: "card.hash-4ea204b4fa413be39f3508c65d93d8ef270e1bb64d97edf9a216efa7d50394f4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：" +
    "(1)「deal 2 to all enemy units here」是非目标整组伤害（355.10.d/355.10.d.1），" +
    "但已合入的 effect.damage 只接受 Finalize 锁定的 TargetSpec（args.target 必须是 TargetSpec id 字符串，ctx.targets(id) 读取），" +
    "没有 effect.ready/effect.heal 那样的 { kind: \"query\", filter } 集合分支——golden 实测把集合描述符交给该原语会抛 " +
    "\"effect.damage args.target must be a TargetSpec id string\"；用 TargetSpec 近似会错误触发成为目标（355.7/754），故只保留非目标集合描述符。" +
    "(2) attack-declared 时点（383.4.e）没有发射方：单测的合成 emission 能注册触发，但生产 combat/ 从不发出该时点——" +
    "combat/flow.ts 在开启已 staged 的 Combat 时抛 TurnCombatBlockedError('combat-start-transaction')，也不给单位分配 Attacker/Defender designation，" +
    "全仓库没有 attack-declared 的 emit 调用，golden 实测一次真实 move-location 只发出 object-moved，触发无法进入链。" +
    "(3) [Accelerate] 的展开文件虽已合入（调整后的 expand 产出 accelerate.cost 静态能力 + object-enters-board 替代），" +
    "但 programs/statics.ts 的 layerFor 不映射 accelerate.cost（实测 ProgramBindingError \"Static ability kind accelerate.cost has no layer mapping\"），" +
    "cost/cost-plan.ts 只消费调用方传入的 optionalAdditional，没有任何生产方把卡上 keyword 转成 1 Energy + 1 Fury Power 的费用组件与 805.6 入场就绪替代。" +
    "Trigger Condition「4 or fewer runes」本身可真实求值：模板 golden 在真实链路上验证了 4 runes 触发、5 runes 不触发（383.4.e.2.b）。",
  abilities: [
    // 805.1.b：费用固定为 [1] + 一个与单位域匹配的 Power，keyword 不带数值（805.4 多个实例冗余）。
    { kind: "keyword", keyword: "accelerate" },
    {
      kind: "triggered",
      trigger: {
        at: "attack-declared",
        filter: { event: "attack-declared", filter: { source: "self" } },
        // 383.4.e.2.a：攻击触发的条件每个战斗只检查一次。
        once: "per-combat",
        // 383.2.a.1："if you control 4 or fewer runes" 是触发条件本身。
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "runes-you-control",
            filter: { type: "rune", zone: "rune-zone", controller: "self" }
          },
          operator: "lte",
          right: { kind: "constant", value: 4 }
        }
      },
      optional: false,
      body: [
        {
          id: "renekton.deal-2-to-enemy-units-here",
          op: "effect.damage",
          args: {
            amount: { kind: "constant", value: 2 },
            // 355.10.d："all enemy units here" 是按特征程序化选出的集合，玩家无从选择，
            // 因此不是目标；"here" 用 sameLocationAs 锚点绑定来源当前位置（359.3.f）。
            // 已合入的 effect.damage 还没有消费该描述符的分支（见 judgeReason 第 1 条）。
            objects: {
              kind: "constant",
              value: {
                kind: "query",
                filter: {
                  type: "unit",
                  zone: "board",
                  controller: "opponent",
                  sameLocationAs: "self"
                }
              }
            }
          }
        }
      ]
    }
  ],
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
    "When I attack, if you control 4 or fewer runes, deal 2 to all enemy units here."
} satisfies CardProgram;
