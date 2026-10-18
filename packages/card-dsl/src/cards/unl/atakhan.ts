import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Atakhan — CR v1.5 356.2.b.1/356.4.f.1 (optional additional cost),
 * 206 (printed/copied cost), 810 (Ganking), 383.4.e/359.3.f (attack/here).
 * cost.pay/cost.modify、kill 费用种类与卡牌触发绑定均已合入；剩余边界见 judgeReason。
 */
const ENEMY_UNIT_HERE = "atakhan.defender-unit-here";

const abilities: Ability[] = [
  {
    // 356.2.b / 356.2.b.1：可选附加费用（由被打出卡牌自身的 Passive Ability 指定）。
    // 描述性声明：cost.additional 在生产链里仍没有消费方（programs/play.ts 的
    // translateCost 与 programs/statics.ts 的 layerFor 都不接受它），见 judgeReason 第 1 点。
    kind: "static",
    effect: {
      kind: "cost.additional",
      id: "atakhan.additional-cost",
      appliesTo: "self",
      optional: true,
      stage: "optional-additional",
      payments: [
        {
          kind: "kill",
          amount: { kind: "constant", value: 1 },
          choice: {
            // 355.10.c：费用里的对象不是目标；选择者是支付者。
            id: "atakhan.friendly-unit",
            options: ["friendly-unit"],
            min: 1,
            max: 1,
            selection: "one",
            type: "unit",
            zone: "board",
            controller: "self"
          }
        }
      ]
    }
  },
  {
    // 356.4.b / 356.4.c / 206：由该可选费用授予的分量折扣；量读被消灭单位的印刷费用。
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      appliesTo: "self",
      resource: "energy",
      // 206：按“被支付费用的那个单位的印刷 Energy 费用”每点少 1。这里用 count 表达式
      // 保留“读取该费用对象印刷费用”的意图（合取的 filter 只作可审查记号，区域
      // cost-receipt 不是真实区域，故在依赖落地前 fail-closed；与 rad/shimmering-swimmer
      // 的 cost-receipt 占位同型），不写成静态常量近似。
      amount: {
        kind: "count",
        subject: "energy-cost-of-the-killed-unit",
        filter: { zone: "cost-receipt" }
      },
      stage: "discount",
      // 356.4.f.1：只在该可选附加费用真的被选择时生效。
      grantedBy: "atakhan.additional-cost"
    }
  },
  {
    kind: "static",
    effect: {
      kind: "continuous.cost-modification",
      appliesTo: "self",
      resource: "power",
      // 206 / 135.2.e.4：被消灭单位每一点印刷/复制 Power（不限领域），少 1 枚 Order Power；同样用
      // cost-receipt 占位（依赖落地前 fail-closed，不写静态常量近似）。
      amount: {
        kind: "count",
        subject: "power-cost-of-the-killed-unit",
        filter: { zone: "cost-receipt" }
      },
      domains: ["Order"],
      stage: "discount",
      grantedBy: "atakhan.additional-cost"
    }
  },
  // 810：Ganking 只声明，展开归 effects/keywords/Ganking.ts。展开能注册为
  // continuous.movement，但其 permission 字符串不是 movement() 消费的 routes
  // （见 judgeReason 第 4 点）。
  { kind: "keyword", keyword: "ganking" },
  {
    kind: "triggered",
    trigger: {
      at: "attack-declared",
      filter: { event: "attack-declared", filter: { source: "self", player: "controller" } }
    },
    optional: false,
    body: [
      {
        id: "atakhan.defender-kills",
        op: "effect.kill",
        args: {
          // “the defender must kill one of their units here”：非目标的强制选择
          // （355.10.c 的结算期选择）；候选范围（防御者控制 + here）与按玩家扇出
          // 未合入，这里只保留形状（见 judgeReason 第 3 点）。
          picks: { kind: "constant", value: "atakhan.defender-unit-here" }
        },
        picks: [
          {
            id: ENEMY_UNIT_HERE,
            options: ["defender-unit-here"],
            // “here”＝本卡所在战场（359.3.f），用契约 3.6 的 sameLocationAs 锚点；
            // “the defender's” 的玩家求值没有 IR 形态（见 judgeReason）。
            filter: { type: "unit", zone: "board", sameLocationAs: "source" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-828f8b87c552d0b972bcc9a40a8e2ec7760cfe5125ba1d735038c830884900c3",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "当前缺口（CR v1.5）：(1) cost.pay/cost.modify、kill 费用种类与可选费用凭证已合入，但 static cost.additional/grantedBy 声明仍没有生产消费方：" +
    "programs/play.ts 的 translateCost 对 kind \"additional\"/\"additional-cost\" 及 additional/discount/optional 字段直接 judgeRequired；" +
    "cost/discounts/collect.ts 虽能消费普通 cost.modify 声明，却拒绝本卡的 grantedBy/optional-additional 关联，" +
    "而 createEngineStaticBinder 也没有 cost.additional / continuous.cost-modification 的 layer 映射（两者实测抛 judge-required），" +
    "因此 356.2.b.1/356.4.f.1 的选择与减费闸门在 Finalize 里仍未接通。" +
    "(2) 206 要求读取被选择作费用单位的印刷或复制 Energy/Power 费用：现有 amount 只有 count(zone: cost-receipt) 占位，" +
    "IR 没有读取“支付该费用时那个对象”的印刷费用快照的形状，也没有按 Power 符号数计算 Order 分量折扣的表达式；cost-receipt 不是真实区域。" +
    "(3) attack-declared 仅有时点定义，生产发射方仍缺（combat/flow.ts 在 combat 开启路径抛 TurnCombatBlockedError('combat-start-transaction')），" +
    "且 TriggerSpec 还不能把本次防御者、攻击地点与选择者绑定到 effect.kill 的非目标选择（383.4.e/359.3.f）。" +
    "(4) Ganking 已展开为 continuous.movement 且该 static 能经 createEngineStaticBinder.bindStatic 注册（实测成功，" +
    "不再抛 layer mapping 错误），但展开的 permission 是字符串 \"battlefield-to-battlefield\"：" +
    "layers/rules/query.ts 的 movement() 只从 permission.routes 生成许可，故查询到的 routes 为空、canGank 仍为 false（实测），" +
    "该 static permission 字符串尚未转换为规则查询消费的 routes，不能据此宣称整卡可执行。",
  abilities,
  sourceText:
    "You may kill a friendly unit as an additional cost to play me. If you do, I cost :rb_energy_1: less " +
    "for each Energy it costs and :rb_rune_order: less for each Power it costs.\n" +
    "[Ganking] (I can move from battlefield to battlefield.)\n" +
    "When I attack, the defender must kill one of their units here."
} satisfies CardProgram;

export default program;
