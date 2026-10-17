import type { CardProgram } from "../../ir/index.js";

/**
 * Might of Demacia, Starter (ogs-023-024) — Legend, Body/Order, 标签 Garen/Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogs-023-024）：
 *   When you conquer, if you have 4+ units at that battlefield, draw 2.
 *
 * 规则依据（CR v1.5）：
 * - 383.1 / 383.4.c / 383.4.c.1：“When you conquer …” 是 Conquer Effect
 *   （触发条件包含一名单位参与并成功征服战场；383.4.c.2.b：引用征服玩家的能力）。
 * - 383.2.a.1：紧跟在触发条件之后的 “if …” 从句属于触发条件（Trigger Condition），
 *   不在结算时判定；判定发生在征服事件处理时。
 * - “that battlefield” 是 359.3.f 的 referent：指本次征服事件发生的那块战场。
 * - 740.2.a/740.1.a："units" 默认指单位；"you have" 指能力控制者（190.6.d）
 *   在该战场上的单位数；355.10.d 的按特征自动选取不构成目标。
 * - 414.1 / 414.3：“Draw 2.” 用已合入的 effect.draw（隐含抽牌者为能力控制者）。
 * - 174 / 174.7：Legend 可以有 Triggered Ability；107.4.c / 174.2.b：始终留在
 *   Legend Zone。
 *
 * status = judge-required：见 judgeReason。conquer 时点已由 TurnFlow 的 Score 波真实
 * 发出（turn/flow.ts 的结构化 timing wave），details 带 battlefieldId 标量；但触发
 * 条件里的「在 that battlefield 有 4+ 单位」仍需要：按征服事件的战场引用（359.3.f
 * 的 referent）做集合计数的 condition 形式（count/compare 读不到事件载荷、没有
 * "事件本轮次的战场" 位置锚点），以及带 condition 的注册所要求的宿主 testTrigger
 * 适配器（events/pipeline.ts 抛 "Trigger condition adapter required"）。触发绑定" +
 * 本身（RIFT-257）已合入。不近似实现。
 */
const mightOfDemaciaStarter = {
  canonicalCardId:
    "card.hash-befcf314a3bbe2053ad3e09a6000efe606106fb3dcd65a480a200abe436f4085",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不属于本卡 write scope：(1) 触发条件里的参照物「4+ units at that battlefield」" +
    "需要征服事件携带的“本次征服的战场”引用（CR 359.3.f）并据此计数：conquer 时点已由 TurnFlow 的 " +
    "Score 波真实发出且 details 带 battlefieldId 标量（turn/flow.ts；383.2.a.1 的触发条件语义），" +
    "但 count/compare 条件读不到事件载荷，TriggerSpec/EventPattern 没有“事件本轮次的战场”位置锚点" +
    "（ObjectFilter.location 只接受具体位置 id 或 region 字符串），也没有按事件位置计数的 condition 形式；" +
    "(2) 带 condition 的触发注册要求宿主提供 testTrigger 适配器（events/pipeline.ts 抛 \"" +
    "Trigger condition adapter required\"，已合入 host 都不提供）。" +
    "已合入的部分：effect.draw、conquer 时点与卡牌触发绑定（RIFT-257，attachLifecycle/" +
    "registerProgramTriggers）均已合入；golden 对 draw 体、conquer 时点与 filter 的玩家等值半边做" +
    "真实执行/匹配验证；Legend 的来源区域是 Legend Zone（CR 107.4.c / 174.2.b），契约 ZoneId 与参考内核" +
    "都没有该区域。依赖：事件战场 referent 的计数条件与事件位置载荷（契约变更请求）、" +
    "testTrigger 适配器、Legend Zone 扩展。不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        filter: {
          // 契约 3.5 的 EventPattern discriminator 取自 events/trigger-spec.ts 的
          // EVENT_PATTERN_TYPES：征服事件的封闭拼写是 "conquered"（pipeline-match
          // 的 EVENT_NAMES 把它映射到 conquer 时点）。旧 sfd 卡写作 event: "conquer"，
          // engine 的 validateTriggerSpec 会拒绝该拼写，因此按契约写 "conquered"。
          event: "conquered",
          // "you conquer"：征服者即本能力控制者（190.6.d、383.4.c.2.b）。
          player: "self"
        },
        // 383.2.a.1：紧邻条件从句属于触发条件；这里按「本次征服战场上的己方单位数 ≥ 4」
        // 写出形状，事件的战场引用（359.3.f 的 that battlefield）当前没有载体，见 judgeReason。
        condition: {
          kind: "compare",
          left: {
            kind: "count",
            subject: "conquering-battlefield-units",
            // "you have" = 本触发能力的控制者；ObjectFilter.controller 的 "self"
            // 是 events/trigger-spec.ts PlayerSelector 支持的拼写（由触发管线解析
            // 为能力控制者），不是运行时玩家 id。
            filter: { type: "unit", controller: "self" }
          },
          operator: "gte",
          right: { kind: "constant", value: 4 }
        }
      },
      optional: false,
      body: [
        {
          id: "might-of-demacia.draw-2",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 2 } }
        }
      ]
    }
  ],
  sourceText: "When you conquer, if you have 4+ units at that battlefield, draw 2."
} satisfies CardProgram;

export default mightOfDemaciaStarter;
