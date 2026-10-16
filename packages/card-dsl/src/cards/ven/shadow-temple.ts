import type { CardProgram } from "../../ir/index.js";

/**
 * Shadow Temple (ven-165-166) — Battlefield, Colorless.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-165-166，逐字）：
 *   "When you hold here, [Burn 3]. (Put the top 3 cards of your Main Deck into your trash.)"
 *
 * 规则依据（Core Rules v1.5）：
 * - 383.4.d / 383.4.d.1 / 383.4.d.2.b："When you hold here" 是 Hold Effect，即一条由
 *   持有战场的玩家触发的触发能力；对应封闭时点 hold（事件定义引用 315.2.b.2 / 471.2 /
 *   473.2.b），190.6.a / 190.6.d 让 "you" 取战场控制者。383.4.d.2.c：得分被否定或替代
 *   时仍会触发，因此指令体是一条无条件的烧牌，不依赖得分结果。
 * - 441.1 / 441.2 / 441.2.a：Burning 就是「把一名玩家主牌库顶的牌移到其弃牌区」，
 *   格式为 "Burn X."，X 为要烧的牌数（此处 3）。
 * - 441.4 / 432：作为效果的一部分必须尽可能多地烧牌，牌库不足只烧得到的部分并交给内核
 *   处理后续（Burn Out 由内核负责，原语只读取真实结果）。括号里的文字是 [Burn 3] 的提示
 *   文本（441.2 的动作格式说明），不构成第二条能力。
 * - 已合入原语：effect.mill（RIFT-112）就是该动作，它用 zoneSlice 按真实区域顺序取主牌库顶，
 *   经 ctx.perform({type:"mill"}) 提交 GameAction，并链接 burned / burnedCount / burnedCard /
 *   burnedPlayer。
 *
 * status = judge-required（复核 2026-10-16；缺口在触发侧，不近似实现）：
 * 1. hold 时点已由合入的回合/计分流程发出（turn/flow.ts scheduleScore 在 Beginning 的
 *    Hold 计分步骤提交 Score 时产生 'hold' + 'score' 发射并带 details.battlefieldId；
 *    engine-core/test/game/lifecycle.test.mjs 断言），RIFT-257 的卡牌程序绑定
 *    （src/programs/triggers.ts）也已能注册 CardProgram 的 triggered ability。
 * 2. 仍未接通的是 053.3 的 "here" 锚点：事件的战场身份只在 details.battlefieldId 载荷里，
 *    静态 filter 读不到事件出的战场（pipeline-match.ts 的 details 匹配只接受写死的值），
 *    here 过滤器键会被 programs/filters.ts 的 translateTriggerFilter 以 judge-required
 *    拒绝（fail closed，不静默放行），190.6 的战场能力控制者解析同样没有接线。
 * 3. 指令体本身完全可执行：golden 用真实解释器 + 参考内核执行 effect.mill，断言主牌库顶 3 张
 *    按顶到底顺序进入弃牌区、牌库不足时只烧得到的部分、动作被替代时整条指令 negated。
 * 依赖：053.3 here 锚点 / 190.6 战场能力绑定。
 */
export default {
  canonicalCardId: "card.hash-cd62916d98e552e83db520590945a7564cccd36cd0f631954e41d7c21e16695a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "指令体已用已合入原语表达并有真实执行证据（effect.mill（RIFT-112）按 441.1/441.2/441.4 把主牌库顶 3 张移到弃牌区，" +
    "牌库不足只烧得到的部分、被替代时 negated），阻断只在触发侧：" +
    "① hold 时点（383.4.d.2.b / 471.2 / 473.2.b）已由合入的回合/计分流程发出（turn/flow.ts scheduleScore 的 Hold 计分步骤" +
    "产生 'hold' 发射并带 details.battlefieldId，engine-core/test/game/lifecycle.test.mjs 断言），" +
    "RIFT-257 的卡牌程序绑定（src/programs/triggers.ts）也已能注册 CardProgram 的 triggered ability；" +
    "② 仍未接通的是 053.3 的「here」锚点：事件的战场身份只在 details.battlefieldId 载荷里，静态 filter 读不到事件出的战场" +
    "（pipeline-match.ts 的 details 匹配只接受写死的值），程序里的 here: true 会被" +
    "programs/filters.ts 的 translateTriggerFilter 以 judge-required 拒绝（fail closed，不静默放行），" +
    "190.6 的战场能力控制者解析同样没有接线。" +
    "依赖：053.3 here 锚点 / 190.6 战场能力绑定（触发注册器本身已随 RIFT-257 合入）。不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        // "held" 是封闭事件判别值（EVENT_NAMES 将其映射到 hold 时点）；
        // "here" 是本战场（053.3）的未绑定指代，"self"/"controller" 是能力控制者。
        filter: { event: "held", here: true, player: "self" }
      },
      optional: false,
      body: [
        {
          // "[Burn 3]" / "Put the top 3 cards of your Main Deck into your trash."
          // （441.1/441.2/441.4）：烧牌者缺省为能力控制者（190.6.d），
          // 主牌库顶与 Burn Out 的后续由内核拥有，本指令不自行改区域。
          id: "shadow-temple.burn-3",
          op: "effect.mill",
          args: { amount: { kind: "constant", value: 3 } }
        }
      ]
    }
  ],
  sourceText:
    "When you hold here, [Burn 3]. (Put the top 3 cards of your Main Deck into your trash.)"
} satisfies CardProgram;
