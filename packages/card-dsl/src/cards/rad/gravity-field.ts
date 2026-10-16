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
 * status：judge-required。三处依赖尚未合入，均不近似实现：
 * 1. Deploy 没有已合入的 KeywordDef：effects/keywords/ 的 16 个已注册关键词不含
 *    Deploy，830.1.b 的四项改写（入场地点许可、非单位不被召回、对手固守时消灭）
 *    都没有展开实现。调研表把 kw-deploy 归到 continuous.location / continuous.restrict
 *    （docs/plans/survey/ability-templates.md 第 3 节），两者目前没有消费方。
 * 2. Applied Cost（204.4）没有对应指令原语，也没有读取静态成本声明的移动费用管线；
 *    本程序只按开放形状保留声明（effect 内的 mode/action/cost 是描述性数据）。
 * 3. Deathknell 关键词展开（RIFT-82，effects/keywords/Deathknell.ts）已注册，但其指令体
 *    使用未注册的 op trigger.leave（engine-core 的 instructions 注册表没有该原语），
 *    实测展开体会抛 “Unregistered instruction opcode: trigger.leave”；此外没有
 *    卡牌程序 → 关键词 → 时点/链的接线（契约 3.5）。
 * Draw 1 原语本身已合入，golden 测试单独执行它，但不据此宣称整卡可执行。
 */
export default {
  canonicalCardId: "card.hash-d406d8dc66cee52b94dfb12d6f6e4fc13ed28937147e943fb4c4f4478b6bb58c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处依赖未合入：(1) Deploy 关键词没有 KeywordDef（CR 830.1.b 的入场地点许可、" +
    "非单位 Gear 不被召回、对手固守时消灭都需要展开；调研表 kw-deploy 指向的 " +
    "continuous.location/continuous.restrict 尚无消费方）；(2)「Opponents must pay " +
    ":rb_energy_1::rb_rune_rainbow: to move …」是 Applied Cost（CR 204.4/204.4.b），" +
    "没有指令原语或读取静态成本声明的移动费用管线（rainbow Power 支付路径也未合入）；" +
    "(3) Deathknell 展开体（RIFT-82）使用未注册的 op trigger.leave，" +
    "engine-core instructions 注册表没有该 op，且缺少卡牌程序→关键词→时点/链的接线（契约 3.5）。" +
    "Draw 1 已单独执行，但局部原语执行不构成整卡证据；不近似实现。",
  abilities: [
    // 830.1：印刷的 [Deploy] 声明。展开由关键词注册表负责，当前没有 Deploy 定义。
    { kind: "keyword", keyword: "deploy" },
    {
      // 204.4：Applied Cost。静态声明开放形状：作用于移动动作、支付者为对手、
      // 费用为 1 能量 + 1 rainbow Power。字段是描述性数据，不是可执行原语调用。
      kind: "static",
      effect: {
        kind: "continuous.restrict",
        mode: "applied-cost",
        action: "move",
        payers: "opponent",
        filter: { type: "unit", location: { source: "self" } },
        cost: { energy: 1, power: ["rainbow"] }
      }
    },
    // 808.1：印刷的 [Deathknell] 声明，展开由 effects/keywords/Deathknell.ts 负责。
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
