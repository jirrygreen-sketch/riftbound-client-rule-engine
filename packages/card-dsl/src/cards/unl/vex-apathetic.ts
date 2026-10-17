import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Vex, Apathetic (unl-150-219) — Unit, Chaos, tags Yordle/Vex/Shadow Isles/Champion.
 * energy 4（power: null，无印刷力量费）, Might 4.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-150-219，逐字）：
 *   [Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)
 *   When an opponent plays a unit while I'm at a battlefield, [Stun] it. They can't move it this turn.
 *   (It doesn't deal combat damage this turn.)
 *
 * 规则依据（CR v1.5）：
 * - [Deflect]（809.1.b.3：省略数值视为 1；809.1.c 的对手附加 Power 费用；809.1.d 是强制性附加费用）
 *   是关键词；卡牌只声明（契约 3.1/3.7、README 第 5 节），展开归 effects/keywords/Deflect.ts（static target.tax）。
 * - “When an opponent plays a unit” 是打出事件触发（420.4.a；383.4.a.4 说明它不是 Play Effect），
 *   时点用封闭枚举的 card-played，事件对象为对手控制的单位（740.1.b 的 enemy 定义）。
 * - 383.2.a.1：“while I'm at a battlefield” 紧跟触发条件，属触发条件的一部分，在进链前求值。
 * - “[Stun] it”（424.1/424.1.a/424.1.a.1/424.2）是 Stun 动作，用已合入的 effect.stun；
 *   424.1.a.1 规定已 Stunned 的单位不能被再次 Stun（原语自身覆盖该边界）。
 * - “They can't move it this turn” 是对该单位的移动禁止（054/054.1 的“禁止压过许可”，449 的 Move），
 *   属持续移动限制；连同本回合期限（317/318 的清理到期）由 continuous.movement + duration 表达。
 * - reminder “It doesn't deal combat damage this turn” 是 Stunned 结果的释义（424.1.b），不是独立指令。
 *
 * status = judge-required（缺口不近似实现）：
 * - [Deflect]（809）的展开文件虽已合入（static target.tax），但没有消费方把永久物上的 target.tax
 *   接进目标选择与费用计划（target/target-plan.ts 的 tax 只来自调用方显式传入，RIFT-360），
 *   也没有把 809.1.c.1 的“任意域 Power”接入费用计划（RIFT-261）。
 * - “it” 指触发事件里的单位：契约 3.6 的 ObjectSelector 只有 self/source/target/pick/linked，
 *   没有“触发事件对象”选择器，因此效果里的 TargetSpec 只是形状保留（355.10.c 明确“it”不是选目标），
 *   真实绑定必须由触发系统在进链时完成（383.2.c.3.b / 359.3.f.3，引擎批 4）。
 * - 触发条件 “while I'm at a battlefield” 没有进链前求值路径：带 condition 的触发注册要求
 *   host.testTrigger 适配器，已合入 host 都不提供，也没有把来源的 last-known 位置交给卡牌条件。
 * - continuous.movement 原语与本回合期限已合入，但移动系统（zones/movement.ts）仍不读图层许可/限制。
 * 依赖：RIFT-360（目标税）、RIFT-261（费用计划）、移动许可消费方与触发条件求值。不近似实现（不把 Deflect 换成数值近似，
 * 也不把“不能移动”写成事实上的允许）。
 */
const abilities: Ability[] = [
  // 契约 3.7 / README 第 5 节：关键词只声明，不重写展开。
  { kind: "keyword", keyword: "deflect" },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: {
        event: "card-played",
        // “an opponent plays a unit”：事件对象是刚打出的单位，由本能力的对手控制。
        object: { type: "unit", controller: "opponent" }
      },
      // 383.2.a.1：附加条件从句属于触发条件，在进链前判定。
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "objects",
          filter: {
            // “while I'm at a battlefield”：来源自身位于战场（053.3 的 here 语义）。
            object: "self",
            location: "battlefield"
          }
        },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
    },
    optional: false,
    body: [
      {
        id: "vex-apathetic.stun-the-played-unit",
        op: "effect.stun",
        args: { target: { kind: "constant", value: "vex-apathetic.played-unit" } },
        targets: [
          {
            id: "vex-apathetic.played-unit",
            // 形状保留：355.10.c 规定触发条件/替代效果引用的对象不是选目标，
            // 这里的 TargetSpec 用于保留 “it” 的指称与过滤维度，真实绑定由触发系统提供（见 judgeReason）。
            filter: { type: "unit", controller: "opponent", zone: "board" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      },
      {
        id: "vex-apathetic.cant-move-it",
        op: "continuous.movement",
        args: {
          operation: { kind: "constant", value: "move" },
          // 054/054.1：这是禁止（禁止压过许可），不是授予移动许可。
          forbidden: { kind: "constant", value: true },
          period: { kind: "constant", value: "this-turn" }
        },
        targets: [
          {
            id: "vex-apathetic.played-unit",
            filter: { type: "unit", controller: "opponent", zone: "board" },
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
  canonicalCardId:
    "card.hash-716820b241f51e2a45c749824d33ddeaa97919c6443d116c499135360b20184c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口（均不近似实现）：(1) [Deflect]（809.1.c/809.1.d）的展开（effects/keywords/Deflect.ts 的 static target.tax）没有消费方：" +
    "target/target-plan.ts 的目标税只来自调用方显式传入的 tax，没有从永久物的持续效果派生目标税的路径（RIFT-360），" +
    "809.1.c.1 的“任意域 Power”支付也没有接入费用计划（RIFT-261）。" +
    "(2) “it” 指触发事件里的单位：契约 3.6 的 ObjectSelector 只有 self/source/target/pick/linked，缺“触发事件对象”选择器，" +
    "卡内的 TargetSpec 只是形状保留（355.10.c 明确该对象不是选目标），真实绑定按 383.2.c.3.b/359.3.f.3 属触发系统（引擎批 4）。" +
    "(3) 触发条件 “while I'm at a battlefield”（383.2.a.1 属触发条件）没有进链前求值路径：带 condition 的注册要求 host.testTrigger 适配器，" +
    "已合入 host 都不提供，也没有把来源的 last-known 位置交给卡牌条件。" +
    "(4) “They can't move it this turn” 是持续移动禁止（054/054.1、449）：continuous.movement 原语与本回合期限已合入，" +
    "但移动系统（zones/movement.ts）仍不读图层的移动许可/限制。依赖：RIFT-360、RIFT-261、移动许可消费方与触发条件求值。[Stun] 本体（effect.stun，424.1）已合入，" +
    "golden 以锁定目标真实执行该半段。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "When an opponent plays a unit while I'm at a battlefield, [Stun] it. They can't move it this turn. " +
    "(It doesn't deal combat damage this turn.)"
} satisfies CardProgram;
