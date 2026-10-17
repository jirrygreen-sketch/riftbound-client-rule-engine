import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Riven, Shattered (ven-041-166) — Unit, Calm, 3 Energy + 1 Calm Power, Might 3,
 * tag Noxus/Riven/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-041-166，逐字）：
 *   [Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for
 *   :rb_rune_rainbow: less, even if it's already attached.)
 *   When I attack, choose an enemy unit here. Deal 2 to it for each Equipment attached to me.
 *
 * 规则依据（Core Rules v1.5）：
 * - 821.1 / 821.1.a / 821.1.b / 821.1.c：Weaponmaster 是打出时的可选关键词能力，
 *   允许把一件自己的 Equipment 以“少 1 点任意域 Power”的 Equip 费用附着到本卡；
 *   821.1.c.1 明确该 Equipment 不必拥有 Equip 能力，821.1.c.6 说明这次不会真的启动
 *   Equip 能力、也不会选中拥有 Weaponmaster 的单位。按契约 3.7 卡牌只声明关键词，
 *   展开（cost.modify / cost.pay / effect.attach 的序列）归 keywords/Weaponmaster.ts
 *   （已在 engine-core/src/effects/keywords/Weaponmaster.ts 合入，但仍是 judge-required）。
 * - 383.4.e / 383.4.e.1 / 383.4.e.2："When I attack" 是 Attack Trigger，即在单位第一次
 *   取得 Attacker 指定时触发（383.4.e.2.a 说明每次战斗只检查一次）；封闭时点
 *   events/timing-points.ts 的 "attack-declared"（ruleRefs 323.2/383.4.e/466.2.c），
 *   filter 内层锚点用契约 3.6 的 source: "self" 指称本卡。
 * - 355.5 / 355.7 / 355.9.a.1 / 355.9.b："choose an enemy unit here" 是选择具体对象参与
 *   目标相关规则（355.10.a.1 的 Board 为公开信息），因此是被选目标（TargetSpec）；
 *   "here" 用契约 3.6 的 sameLocationAs 锚点（BASE_FILTER 同源；本卡能力来源的位置）
 *   排除基地与其他战场上的敌方单位。
 * - 418.1/418.1.a/418.1.b/418.1.e/418.1.e.1：“Deal 2 to it for each Equipment attached to me”
 *   造成 (2 × 附着于本卡的 Equipment 数量) 点伤害。数量是集合计数，用契约 3.2 的 count
 *   表达式 + ObjectFilter 的 attachedTo: "self" 锚点（355.10.d.1 的按特征集合，不额外选目标），
 *   再乘印刷常量 2（contract 3.4 的 arithmetic 图层外的实数计算）。战斗与非战斗伤害由
 *   combat: false 区分（本条是效果伤害，不是 467 的战斗伤害）。
 *
 * status = judge-required（三处缺口均不近似实现）：
 * 1. [Weaponmaster] 的展开文件（effects/keywords/Weaponmaster.ts）虽然已合入，但其引用的
 *    cost.modify / cost.pay 原语在 821.1.c.2 的 Equip 费用语义上没有消费方：
 *    cost.modify 的 reduce-equip-cost 分支会按“821.1.c.2 缺权威 Equip 费用绑定”设计性抛出，
 *    费用计算与支付不会执行。
 * 2. CardProgram → TriggerRegistration 的通用路径已由 programs/triggers.ts + lifecycle.ts
 *    接入，但 programs/filters.ts 尚不支持 TargetSpec 的 sameLocationAs（053.3/355.11，RIFT-359），
 *    所以本卡的注册在目标翻译处仍被 judge-required 阻断。
 * 3. attack-declared 时点没有发射方：combat/ 不把 Attacker 指定接入事件管线（全仓库没有
 *    attack-declared 的 emit 调用，同 sfd/azir-sovereign、sfd/lucian-gunslinger 的记录）。
 * 依赖：权威 Equip 费用绑定与 reduce-equip-cost 消费方、sameLocationAs 目标过滤适配、战斗触发发射。
 * 已合入的 effect.damage 与 count + attachedTo 锚点在 golden 中用真实目标与真实附着关系执行，
 * 不手改 frame / attachedTo。
 */
const abilities: Ability[] = [
  // 821.1.c：Weaponmaster 只声明关键词身份；减费、目标选择与附着序列归已合入的
  // effects/keywords/Weaponmaster.ts 展开（cost.modify/cost.pay 已合入，但 reduce-equip-cost
  // 因 821.1.c.2 缺权威 Equip 费用绑定而抛出）。
  { kind: "keyword", keyword: "weaponmaster" },
  {
    kind: "triggered",
    trigger: {
      at: "attack-declared",
      filter: { event: "attack-declared", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "riven-shattered.damage-per-equipment",
        op: "effect.damage",
        args: {
          // 418.1：“Deal 2 to it for each Equipment attached to me” = 2 × 附着于本卡的
          // Equipment 数量；数量由 count 表达式在结算时读取（不写死，也不在卡里手算）。
          amount: {
            kind: "arithmetic",
            operator: "mul",
            operands: [
              { kind: "constant", value: 2 },
              {
                kind: "count",
                subject: "equipment-attached-to-self",
                filter: {
                  // 355.10.d.1：按特征集合读取，不产生新的目标选择。
                  type: "gear",
                  tags: ["Equipment"],
                  zone: "board",
                  attachedTo: "self"
                }
              }
            ]
          },
          target: { kind: "constant", value: "riven-shattered.enemy-unit-here" },
          // 本条是效果伤害，不是战斗伤害（418.1.a / 467.2 的划分）：IR 的 args 是值表达式，
          // 因此写 constant；chain/interpreter-adapter.ts 的 LITERAL_FIELDS 会把 effect.damage
          // 的 combat 解包为原语需要的布尔值。
          combat: { kind: "constant", value: false }
        },
        targets: [
          {
            id: "riven-shattered.enemy-unit-here",
            // "an enemy unit here"：355.9.a.1 的 unit 指 Board 对象、355.9.b 的对手限定，
            // 再加 sameLocationAs: "self" 的 053.3 "here"（契约 3.6 锚点）。
            filter: {
              type: "unit",
              zone: "board",
              controller: "opponent",
              sameLocationAs: "self"
            },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-449ee3c99ccb6cbedf40282cf1e6bd9c5f1849ff561c01da7535c34da3628b11",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) [Weaponmaster] 的展开文件（effects/keywords/Weaponmaster.ts）虽已合入，" +
    "cost.modify 与 cost.pay 原语也已合入，但 reduce-equip-cost 分支按 821.1.c.2 缺权威 Equip 费用绑定而设计性抛出，" +
    "费用计算与支付不会执行；" +
    "(2) CardProgram → TriggerRegistration 的通用路径已由 programs/triggers.ts + lifecycle.ts 合入，" +
    "但 programs/filters.ts 尚不支持 TargetSpec 的 sameLocationAs（053.3/355.11，RIFT-359），本卡注册会在目标翻译处以 judge-required 阻断；" +
    "(3) attack-declared 时点（323.2 / 383.4.e / 466.2.c）没有发射方：combat/ 不把 Attacker 指定接入事件管线（全仓库没有 attack-declared " +
    "的 emit 调用）。依赖权威 Equip 费用绑定（reduce-equip-cost 消费方）、sameLocationAs 目标过滤适配与战斗触发发射。" +
    "「choose an enemy unit here」按 355.9.b 声明为被选目标（sameLocationAs: \"self\" 的 053.3 here 锚点），" +
    "「Deal 2 to it for each Equipment attached to me」用 count + attachedTo 锚点在结算时读取附着数量（418.1）；" +
    "effect.damage 本体已合入，golden 用真实目标与真实附着关系执行。",
  abilities,
  sourceText:
    "[Weaponmaster] (When you play me, you may [Equip] one of your Equipment to me for :rb_rune_rainbow: less, even if it's already attached.)\n" +
    "When I attack, choose an enemy unit here. Deal 2 to it for each Equipment attached to me."
} satisfies CardProgram;
