import type { CardProgram } from "../../ir/index.js";

/**
 * Jinx, Rebel (ogn-202-298) — Unit, 5 energy + 1 Chaos power, Might 5。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-202-298）：
 *   When you discard one or more cards, ready me and give me +1 :rb_might: this turn.
 *
 * 规则依据（CR v1.5）：
 * - 「When you discard one or more cards」：弃牌触发（423.1.b：弃牌产生的触发在弃牌完成后执行；
 *   时点 card-discarded 由 events/action-adapter.ts 发出，payload 里带 batchId 区分同一次弃牌批次）。
 * - 「ready me」：effect.ready 省略 objects 时缺省为 { kind: "source" }，即能力宿主本单位（416）。
 * - 「+1 :rb_might: this turn」：带「本回合」期限的临时 Might 修正（432 属性修正层），
 *   在 317.2.c 的回合结束清理里与所有 “this turn” 效果同时到期。effect.buff 的边界注释
 *   明确临时 Might 修正不属于 CR 702/703 的 Buff 标记，契约把它归 layers 的 continuous.might。
 *
 * 结构（契约 3.1/3.2/3.9）与社会化写法：
 * - 单个 triggered 能力：时点 card-discarded，filter 是「你弃牌」的事件（player: controller）；
 * - body[0] 用已合入的 effect.ready（无参数 = ready me）；
 * - body[1] 记录临时 Might 修正的意图（op continuous.might，形状对照 ogn/dangerous-duo.ts）。
 *   该 op 目前没有已注册的指令实现（effects/instructions/ 无 continuous.* 文件），因此本卡
 *   保持 judge-required，golden 只真实执行 body[0]。
 *
 * 「+1 Might this turn」是自我引用（355.10.d：按特征程序化选中、没有选择过程，因此不是目标）；
 * 现有原语里 continuous.might 的描述符带 TargetSpec 只是待实现形状，最终需要非目标 self 形式，
 * 见本文件的契约变更请求说明与 Trifarian Gloryseeker 的同类缺口。
 */
const jinxRebel = {
  canonicalCardId: "card.hash-059595a3565959bb085347df8707eaf005ac8c9d516ca7e8cb0802a873d37ab6",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺两件已合入依赖：(1)「give me +1 :rb_might: this turn」是带 end-of-turn 期限的临时 Might 修正" +
    "（CR 432/433；317.2.c 在回合结束同时到期），契约归 layers 的 continuous.might，" +
    "但 effects/instructions/ 没有对应的指令原语（RIFT-91 只交付 layers 引擎与该持续效果注册面，" +
    "卡牌程序没有指令入口），effect.buff 只处理 CR 702/703 的 Buff 标记、不能替代；" +
    "(2)「one or more cards」指一次弃牌事件只触发一次（CR 423.1.b），而 card-discarded 时点按牌逐张发出" +
    "（payload 带 batchId），trigger-spec 的触发生命期只有 per-turn/per-phase/per-combat/per-showdown/" +
    "per-chain/per-object/per-game，没有 per-batch 去重，按张触发会多触发。" +
    "依赖：新增 continuous.might 指令原语（effects/instructions/），以及 RIFT-120 事件管线的批次触发去重。" +
    "「ready me」部分已用 effect.ready 表达并有执行测试。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-discarded",
        filter: { event: "card-discarded", player: "controller" }
      },
      optional: false,
      body: [
        {
          id: "jinx-rebel.ready-me",
          op: "effect.ready",
          args: {}
        },
        {
          // 「give me +1 Might this turn」— 待实现的连续修正指令；形状见文件头注释。
          id: "jinx-rebel.might-this-turn",
          op: "continuous.might",
          args: {
            amount: { kind: "constant", value: 1 },
            duration: { kind: "constant", value: "end-of-turn" },
            target: { kind: "constant", value: "self-unit" }
          },
          targets: [
            {
              id: "self-unit",
              filter: { object: "self", type: "unit", zone: "board" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "When you discard one or more cards, ready me and give me +1 :rb_might: this turn."
} satisfies CardProgram;

export default jinxRebel;
