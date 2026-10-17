import type { CardProgram } from "../../ir/index.js";

/**
 * Gravity Field (rad-062-167) — Gear, 5 energy + 1 Calm power, tags [Device]。
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json rad-062-167）：
 *   "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)
 *    Opponents must pay :rb_energy_1::rb_rune_rainbow: to move one or more units to
 *    this battlefield. [Deathknell][>] Draw 1. (When I die, get the effect.)"
 *
 * 规则依据（CR v1.5）：
 * - 830 / 830.1.a / 830.1.b：Deploy 是同时具有 Passive 与 Triggered 性质的关键词，
 *   只出现在 Gear 上；功能上等于「可以（且只能）打到任意战场」「非单位 Gear 不被清理
 *   召回」「对手在此固守时消灭此牌」。
 * - 204.4 / 204.4.b：「Opponents must pay … to move …」是 Applied Cost（以 must 引导、
 *   作用于关联游戏动作的被动成本）：随关联动作（此处是标准移动）一起支付，不进链。
 *   支付内容按原文是 1 能量 + 1 rainbow Power。
 * - 808.1.c / 429.1：Deathknell 功能上等于「当我死亡时，[Effect]」；本卡的 [Effect]
 *   是 Draw 1（414.3），抽牌者按 190.6.d 隐含为能力控制者。
 *
 * status：judge-required。逐条复核后的当前缺口（均不近似实现）：
 * 1. Deploy 的 KeywordDef 已合入（RIFT-267，effects/keywords/Deploy.ts）：它把 830.1.b
 *    展开成 static continuous.location（入场地点许可、非单位不被召回）与 hold 触发的
 *    effect.kill 自身。Finalize 已消费 playLocations()，但 CardProgram 的 keyword 展开
 *    仍不能绑定 continuous.location，展开元数据也不符合 playLocations() 的许可字段；
 *    cleanup 已按 Deploy 关键词豁免非单位 Gear（turn/flow.ts，830.1.b.3）；
 *    hold 触发的时点虽然已发出，但没有把 Deploy 的 host battlefield 绑定进订阅。
 * 2. Applied Cost（204.4）现在可由已合入的 continuous.restrict（mode "applied-cost"）
 *    登记，layers/rules/query.ts 的 appliedCosts() 也能按动作名读回（本文件已按该真实
 *    形状改写，golden 真实执行并断言读回值）；但没有任何消费方把登记到的 applied cost
 *    接进标准移动的费用计划；[A] 支付可由费用计划的六域任选要求表达（135.2.e.5.a），
 *    并非通用支付能力缺失。
 * 3. Deathknell 关键词展开（RIFT-82）仍未完成：effects/keywords/Deathknell.ts 的指令体
 *    引用尚未合入的 op trigger.leave，展开体会抛 “Unregistered instruction opcode:
 *    trigger.leave”（见 engine-core 的 keywords/Deathknell.test.mjs 记录），
 *    且没有把该展开体接入可执行的离场触发指令。
 * 依赖：Deploy 的 continuous.location/hold 宿主消费、移动费用管线的 applied-cost 消费、
 * 以及 Deathknell 的 trigger.leave 原语。
 */
export default {
  canonicalCardId: "card.hash-d406d8dc66cee52b94dfb12d6f6e4fc13ed28937147e943fb4c4f4478b6bb58c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口（均不近似实现）：(1) Deploy 的 KeywordDef 已合入（RIFT-267 的 effects/keywords/Deploy.ts：" +
    "static continuous.location 的入场许可 + hold 触发的 effect.kill 自身），但没有消费方——" +
    "CardProgram 的 keyword 展开当前不能绑定 continuous.location；Finalize 已消费 playLocations()（chain/engine.ts:383），" +
    "但 Deploy 展开的开放元数据形状（play.anyBattlefield 等）没有 permission/restriction 字符串字段，playLocations() 读不到；" +
    "cleanup 已按 Deploy 关键词豁免非单位 Gear（turn/flow.ts，830.1.b.3）；hold 触发的注册会被绑定层拒绝" +
    "（translateTriggerFilter 抛 Unsupported filter field here，实测），宿主战场绑定仍缺。" +
    "(2)「Opponents must pay :rb_energy_1::rb_rune_rainbow: to move …」是 Applied Cost（CR 204.4/204.4.b），" +
    "现已按已合入的 continuous.restrict（mode applied-cost）真实登记、layers/rules/query.ts 的 appliedCosts() 能读回（golden 已断言），" +
    "但标准移动尚未消费 applied cost 并将其接进费用计划；[A] 的六域任选支付已有支持（135.2.e.5.a）。" +
    "(3) Deathknell 的展开体（RIFT-82）仍引用未注册的 op trigger.leave，展开会抛 Unregistered instruction opcode，" +
    "且 trigger.leave 原语仍未注册。Draw 1 原语已执行，但不构成整卡证据。" +
    "依赖：Deploy 的位置许可/hold 事件消费、标准移动费用管线的 applied-cost 消费，以及 Deathknell 的 trigger.leave 原语。",
  abilities: [
    // 830.1：印刷的 [Deploy] 声明。展开由已合入的 keywords/Deploy.ts 负责（RIFT-267），
    // 生产绑定仍待 continuous.location/hold 宿主消费（见 judgeReason）。
    { kind: "keyword", keyword: "deploy" },
    {
      // 204.4 / 204.4.b：Applied Cost（"Opponents must pay … to move …"）随关联的
      // 标准移动一起支付、不进链。该声明由已合入的 continuous.restrict 原语
      // （mode "applied-cost"，RIFT-259）真实登记，layers/rules/query.ts 的
      // appliedCosts() 按动作名读回（见 golden）。把支付者与费用内容写进 cost，
      // 结构上保留印刷语义；移动费用计划侧的消费仍待接线（judgeReason）。
      kind: "static",
      effect: {
        kind: "continuous.restrict",
        mode: "applied-cost",
        action: "move",
        cost: { energy: 1, power: ["rainbow"], payers: "opponent" }
      }
    },
      // 808.1：印刷的 [Deathknell] 声明，展开由 effects/keywords/Deathknell.ts 负责
      // （展开体仍引用未注册的 trigger.leave，见 judgeReason）。
    { kind: "keyword", keyword: "deathknell" },
    {
      // 808.1.c 的「When I die, [Effect]」本体：Draw 1（414.3）。
      // 自身死亡触发的时点是 object-killed（时点定义见 events/timing-points.ts），
      // filter 用契约 3.6 的符号选择器 self，不写运行时引用。
      kind: "triggered",
      trigger: { at: "object-killed", filter: { self: true } },
      optional: false,
      body: [
        {
          id: "gravity-field.draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText:
    "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
    "Opponents must pay :rb_energy_1::rb_rune_rainbow: to move one or more units to this battlefield.\n" +
    "[Deathknell][>] Draw 1. (When I die, get the effect.)"
} satisfies CardProgram;
