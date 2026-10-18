import type { CardProgram } from "../../ir/index.js";

/**
 * Might of Demacia, Starter (ogs-023-024).
 * CR v1.5 383.4.c/383.4.c.2.b: a controller's Conquer Effect.
 * The immediately following if-clause belongs to the Trigger Condition
 * (383.2.a.1); "that battlefield" is the conquer-event referent (359.3.f).
 * TurnFlow emits conquer with details.battlefieldId and EventPipeline evaluates
 * trigger conditions. The missing part is binding that event location to the
 * count filter, as well as the Legend Zone source (107.4.c, 174.2.b).
 * effect.draw already executes the original Draw 2 body (414.1, 414.3).
 */
const mightOfDemaciaStarter = {
  canonicalCardId:
    "card.hash-befcf314a3bbe2053ad3e09a6000efe606106fb3dcd65a480a200abe436f4085",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺两条生产路径：(1) turn/flow.ts 的 conquer 事件已有 details.battlefieldId，但 count 条件没有把 that battlefield（CR 359.3.f）绑定为位置过滤器的事件锚点，subject: conquering-battlefield-units 不会限制计数到该战场；还需按触发能力控制者过滤单位（CR 383.2.a.1/383.4.c.2.b）。(2) Legend Zone（CR 107.4.c/174.2.b）不在 effects/contract.ts ZoneId 中，programs/lifecycle.ts 也未从该区域注册触发。依赖：征服事件战场的计数锚点与 Legend Zone 生命周期支持（契约变更请求）。",
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
