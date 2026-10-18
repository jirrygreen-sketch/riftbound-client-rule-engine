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
 * 当前缺口以 judgeReason 为准；已合入的原语与通用适配不再列为缺失。
 */
export default {
  canonicalCardId: "card.hash-4ea204b4fa413be39f3508c65d93d8ef270e1bb64d97edf9a216efa7d50394f4",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口：(1) effect.damage 仍要求 args.target 为 TargetSpec id，没有 objects/query 非目标集合分支；355.10.d 的「all enemy units here」不能替换为目标集合（355.7/754）。(2) attack-declared（383.4.e）仍无生产发射方，combat/flow.ts 在 combat-start-transaction 阻断，未分配 Attacker/Defender 身份；通用程序触发绑定及 4/5 runes 条件求值已经存在。(3) Accelerate 已展开为 accelerate.cost 与入场替代，费用计划也能消费 selected optionalAdditional，chain/engine.ts 已按 kind=accelerate 让单位进入 ready；但 programs/statics.ts 的 layerFor 不绑定 accelerate.cost，programs/play.ts 不从关键词生成 1 Energy + 1 Fury Power 的可选追加组件，故尚无印刷关键词 → Finalize 的完整接线。不近似实现。",
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
