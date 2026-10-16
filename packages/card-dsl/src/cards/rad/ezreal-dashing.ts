import type { Ability, CardProgram, Instruction } from "../../ir/index.js";

/**
 * Ezreal, Dashing (rad-180-167) — Unit, 4 energy + 1 Mind power, 3 Might。
 *
 * 原文（本地 deck-catalog，逐字）：
 *   "When I attack or defend, deal damage equal to my Might to an enemy unit here.\n" +
 *   "I don't deal combat damage.\n" +
 *   ":rb_rune_mind:: [Action] — Move me to your base."
 *
 * 规则依据（CR v1.5）：
 * - "When I attack or defend"：383.4.e（Attack Trigger：单位取得 Attacker 身份后作为 Pending
 *   Item 入链、383.4.e.2.a 每次战斗只检查一次条件）与 383.4.f（Defend Trigger 同构）。对应时点
 *   attack-declared / defense-declared（combat/ 发出，已在 timing-points.ts 定义）。
 * - "deal damage equal to my Might to an enemy unit here"：动态数额取来源当前 Might；
 *   "here" 是 359.3.f 的指代（在指令执行时检查来源当前位置），用契约 3.6 的
 *   `sameLocationAs: "self"` 锚点表达；"an enemy unit" 是目标（355.7 / 355.9.a，355.10.d
 *   不适用，因为需要玩家挑一个单位）。effect.damage 已合入并支持 object-property 动态数额。
 * - "I don't deal combat damage."：这是一条持续的战斗伤害限制（连续效果，不是触发），
 *   功能上使本单位不参与 467.2.a/b 的 Might 汇总与 467.2.c 的伤害指派。
 * - ":rb_rune_mind:: [Action] — Move me to your base."：冒号前是启动能力的费用
 *   （204.1.b：冒号前的资源/指令即 Base Cost），即 1 点 Mind Power；[Action] 是许可关键词
 *   （806.1.c）——卡文件只声明 `{ kind: "keyword", keyword: "action" }`，展开归
 *   effects/keywords/Action.ts。效果是 effect.move（448.1 / 421；"my base" 是该单位控制者的
 *   Base，原语用 "controller-base" 表达）；[Action] 叠加 Mind Power 费用的写法与
 *   sfd assembly-rig 的 "[E],[rune]: [trigger]" 同型。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。三处理由：
 * 1. "I don't deal combat damage." 需要 `continuous.combat` 的战斗伤害限制消费方（RIFT-9 第 4 节
 *    kw-tank 同族的 44/76 身份；仓库只有 effect.stun 的注释引用 continuous.combat，没有任何
 *    实现/消费方）；
 * 2. Attack / Defend 触发与 [Action] 的组合还依赖战斗工作流真正发出 attack-declared /
 *    defense-declared（engine-core 目前只有 events/ 管线定义与 duel/ 的迁移中内核）；
 * 3. 启动能力的 Mind Power 费用按 cost 费用计划（RIFT-89）在 Finalize 收取，已合入费用管线，
 *    但卡牌 IR 到真实启动的接线仍属未集成部分（RIFT-120 后继）。
 * 已合入的 effect.damage（动态 Might 数额 + sameLocationAs 锚点）与 effect.move（controller-base）
 * 在 golden 测试里用解释器 + 参考内核真实执行。不近似实现（不把战斗伤害限制写成触发器，也不省略）。
 */

const ENEMY_UNIT_HERE = "ezreal-dashing.enemy-unit-here";
const SELF = "ezreal-dashing.self";

const damageBody = [
  {
    id: "ezreal-dashing.deal-might",
    op: "effect.damage",
    args: {
      // "equal to my Might"：结算时读取来源当前 Might（契约 3.6 evaluate 时机）。
      amount: { kind: "object-property", object: "source", property: "might" },
      target: { kind: "constant", value: ENEMY_UNIT_HERE }
    },
    targets: [
      {
        id: ENEMY_UNIT_HERE,
        // "an enemy unit here"：对手控制、与来源同位置的单位（359.3.f.2 的 here 指代）。
        filter: { type: "unit", controller: "opponent", sameLocationAs: "source" },
        min: 1,
        max: 1,
        selection: "one"
      }
    ]
  }
] satisfies readonly Instruction[];

const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "attack-declared",
      filter: { event: "attack-declared", filter: { source: "self", player: "controller" } }
    },
    optional: false,
    body: damageBody
  },
  {
    kind: "triggered",
    trigger: {
      at: "defense-declared",
      filter: { event: "defense-declared", filter: { source: "self", player: "controller" } }
    },
    optional: false,
    body: damageBody
  },
  {
    kind: "static",
    // "I don't deal combat damage."：战斗伤害限制属于图层/战斗消费方
    // （continuous.combat，与 Tank/Backline 同族）；当前没有实现（见 judgeReason）。
    effect: {
      kind: "continuous.combat",
      restriction: "no-combat-damage",
      appliesTo: "self"
    }
  },
  { kind: "keyword", keyword: "action" },
  {
    kind: "activated",
    timing: "action",
    // 204.1.b：冒号前的 :rb_rune_mind: 是 1 点 Mind Power 费用。
    cost: {
      kind: "activated",
      power: { kind: "constant", value: ["Mind"] }
    },
    body: [
      {
        id: "ezreal-dashing.move-to-base",
        op: "effect.move",
        args: {
          // effect.move 的 source 选择用字符串 "self"/"source"（与 tideturner 等已合入卡一致）。
          objects: { kind: "constant", value: "self" },
          // "your base"：该单位控制者的 Base（effect.move 的 controller-base 目标）。
          to: { kind: "constant", value: "controller-base" },
          linkKey: { kind: "constant", value: "moved" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-7f839c473b5043b9c00abbc5b251e23126eb2b7a039e3edd56d07d54734b7288",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处缺口：(1) 「I don't deal combat damage.」是持续的战斗伤害限制（467.2.a/b 的 Might 汇总与" +
    "467.2.c 的伤害指派），需要 continuous.combat 消费方；仓库里只有 effect.stun 的注释引用它，" +
    "没有实现（RIFT-9 第 4 节 Tank/Backline 同族，均未分配任务）；(2) Attack/Defend 触发依赖战斗" +
    "工作流真正发出 attack-declared / defense-declared（383.4.e/383.4.f；timing-points.ts 已定义，" +
    "combat/ 尚未接入派出路径）；(3) 启动能力的 Mind Power 费用由 RIFT-89 费用计划在 Finalize 收取，" +
    "但卡牌 IR 到真实启动的接线仍属未集成（RIFT-120 后继）。已合入的 effect.damage（动态 Might 数额、" +
    "359.3.f.2 here 指代用 sameLocationAs 锚点）与 effect.move（controller-base）在 golden 测试中真实执行；" +
    "不近似实现（不把战斗伤害限制写成触发器或结算时动作）。",
  abilities,
  sourceText:
    "When I attack or defend, deal damage equal to my Might to an enemy unit here.\n" +
    "I don't deal combat damage.\n" +
    ":rb_rune_mind:: [Action] — Move me to your base."
} satisfies CardProgram;

export default program;
