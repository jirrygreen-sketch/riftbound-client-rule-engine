import type { CardProgram } from "../../ir/index.js";

/**
 * Agony's Embrace (rad-153-167 / rad-175-167) — Legend, Body/Chaos, tag Evelynn.
 *
 * sourceText（packages/card-data/data/deck-catalog.json rad-153-167，逐字）：
 *   "Once each turn, when you play a card from face down, draw 1. Then, if it's not
 *    your turn, discard 1."
 *
 * 规则依据（CR v1.5）：
 * - 383.1 / 383.2.a：“Once each turn, when you play a card from face down” 是触发条件；
 *   383.3.e / 383.3.e.1 规定 “once each turn” 的触发每回合只执行一次（IR 用
 *   TriggerSpec.once = "per-turn"，契约 3.2/3.5）。时点为打出：card-played
 *   （events/timing-points.ts 的 card-played，ruleRefs 359 / 383.4.a / 407）。
 * - “from face down” 指从 Facedown Zone 打出（355.9.a.3 定义 “Facedown card”；
 *   107.3.a 每个战场有一个 Facedown Zone，107.3.e 它不是 location；422.2.a 与
 *   811.1.c.3 规定从面朝下打出会开启链）。Hide 的细节属于关键词展开（RIFT-84）。
 * - “draw 1” 是 effect.draw（414.1 / 414.3），隐式施动者是能力控制者（190.6.d）。
 * - “Then, if it's not your turn, discard 1”：该 “if” 属于效果（383.2.b），在指令
 *   结算时检查（135.2.b.3 / 359.3.f.2）；“it's not your turn” 指当前回合玩家
 *   （CR 304）不是该传奇的操控者。
 *
 * status = judge-required（复核 2026-10-17；缺口均不近似实现）：
 * - “from face down” 无法在触发过滤里判定：Hide 动作仍不在 GameAction 集内，没有模块发出
 *   card-hidden，OBJECT_FILTER_ZONES 也没有 facedown-zone；card-played 的发射点
 *   （chain/engine.ts）只带 object/player，不携带“该牌从哪个区域打出”的来源事实
 *   （CR 355.9.a.3 / 107.3.e）。RIFT-84 已合入的 Hidden KeywordDef 只展开 cost.hidden 声明。
 * - 该事实也不能用 EventPattern.details 声明：RIFT-257 已合入的 programs/filters.ts 把
 *   details 交给 translateObjectFilter，而后者只接受
 *   objectId/cardId/type/controller/owner/zone/location/states/tags/characteristics，
 *   details 会被判为 “Unsupported filter field details” 并在注册时抛 ProgramBindingError
 *   （translateTriggerFilter 只把 details 从嵌套 filter 搬运，顶层 details 仍落进对象过滤）。
 *   改用 states: ["face-down"] 也不成立：states 求值的是事件对象的当前状态，而
 *   card-played 的 object 是打出后的快照（此时已不 faceDown），它描述的不是打出前的来源。
 *   因此程序用顶层 details.fromFaceDown 明确声明该前提并 fail-closed，不把普通打出算进来。
 * - “if it's not your turn” 需要比较“当前回合玩家 vs 能力控制者”：turnPlayer 只存在于
 *   layers/rules/query.ts 的查询输入与 events/pipeline.ts 的 clock，Expr 只有
 *   constant/location/object-property/linked/count/arithmetic，Condition 只有
 *   always/never/compare/all/any/not/expression，没有该谓词位置；object-property 读取的是
 *   ObjectSnapshot 特征，notYourTurn 不在其中（读取抛 MissingInformation → 指令 ignored）。
 * RIFT-257 的 CardProgram → TriggerRegistration 绑定（programs/triggers.ts）已合入，
 * 不再是缺口；该触发无法命中源于上面两条语义事实缺失，而不是订阅层。
 * 两条子效果本身（draw 1、discard 1）都只使用已合入原语，但都位于上述无法判定的
 * 触发/条件之下，所以整卡不能标记 executable；golden 校验结构并独立执行已合入原语。
 */
export default {
  canonicalCardId:
    "card.hash-94134bbbfa792bc74c51d8f90ca3d64c802ed0a643c32b0e50464e8b2431f37d",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "(1)「when you play a card from face down」没有可求值路径：chain/engine.ts 的 card-played 发射" +
    "只带 object/player，不携带打出前区域；Hide 动作不在 GameAction 集内（effects/contract.ts），" +
    "没有模块发出 card-hidden，OBJECT_FILTER_ZONES（events/trigger-spec.ts）也没有 facedown-zone，" +
    "CR 355.9.a.3 / 107.3.e 的 Facedown card 事实无从取得。该事实也无法用 EventPattern.details 声明：" +
    "触发过滤的 programs/filters.ts 把 details 交给 translateObjectFilter，而它只接受 " +
    "objectId/cardId/type/controller/owner/zone/location/states/tags/characteristics，顶层 details " +
    "判为 Unsupported filter field details 并在注册时抛 ProgramBindingError；states:[face-down] 也求值" +
    "事件对象的当前状态，而 card-played 的 object 已是打出后快照（faceDown false），不描述打出前来源。" +
    "(2)「if it's not your turn」（CR 304 / 383.2.b / 135.2.b.3）需要比较当前回合玩家与能力控制者，" +
    "但 Expr 只有 constant/location/object-property/linked/count/arithmetic、Condition 只有 " +
    "always/never/compare/all/any/not/expression；turnPlayer 只存在于 layers/rules/query.ts 的查询输入，" +
    "object-property 读取 ObjectSnapshot 特征，notYourTurn 不在 ObjectSnapshot 中（读取抛 " +
    "MissingInformation → 指令 ignored）。" +
    "draw 1（effect.draw，414.1）与 discard 1（effect.discard，423.1）已有真实执行测试，" +
    "但都在无法判定的触发/条件之下；整卡保持 judge-required，不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        // “when you play a card from face down”：事件物体必须是你打出的、且来自
        // 面朝下区域。“由你打出”由 player 表达；面朝下来源在合并载荷里没有字段
        // （见 judgeReason），这里用 details.fromFaceDown 明确声明，宁可 fail-closed
        // 也不把普通打出的牌算作面朝下打出。
        filter: {
          event: "card-played",
          player: "self",
          details: { fromFaceDown: true }
        },
        // 383.3.e.1：“once each turn” 每回合只执行一次。
        once: "per-turn"
      },
      optional: false,
      body: [
        {
          id: "agonys-embrace.draw",
          // 414.1 / 414.3：“draw 1.”；隐式施动者是能力控制者（190.6.d）。
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        },
        {
          id: "agonys-embrace.discard",
          // “Then, if it's not your turn, discard 1.”：条件从句只作用于本条指令
          // （契约 3.4 的条件作用范围）；该谓词的求值路径缺口见 judgeReason。
          condition: {
            kind: "expression",
            value: {
              kind: "object-property",
              object: "source",
              property: "notYourTurn"
            }
          },
          op: "effect.discard",
          args: {
            amount: { kind: "constant", value: 1 },
            // 423.1.a 的秘密选择需要稳定重放 id；隐式弃牌者是能力控制者。
            choiceId: { kind: "constant", value: "agonys-embrace.discard" }
          }
        }
      ]
    }
  ],
  sourceText:
    "Once each turn, when you play a card from face down, draw 1. Then, if it's not your turn, " +
    "discard 1."
} satisfies CardProgram;
