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
 * status = judge-required（缺口在触发侧，不近似实现）：
 * 1. hold 时点虽在 events/timing-points.ts 的封闭枚举中，但 scoring/（RIFT-76）未接入
 *    chain/events 单管线（RIFT-120），没有生产者 emit hold；运行期也不存在把 CardProgram
 *    的 triggered ability 注册成 TriggerRegistration 的订阅方，190.6 的战场能力控制者解析
 *    同样缺失。filter 的 here: true 是 053.3（"Battlefields say here"）的战场指代占位。
 * 2. 指令体本身完全可执行：golden 用真实解释器 + 参考内核执行 effect.mill，断言主牌库顶 3 张
 *    按顶到底顺序进入弃牌区、牌库不足时只烧得到的部分、动作被替代时整条指令 negated。
 * 依赖：RIFT-76 → RIFT-120（hold 发射与战场能力注册，契约 §7.2 批 5）。
 */
export default {
  canonicalCardId: "card.hash-cd62916d98e552e83db520590945a7564cccd36cd0f631954e41d7c21e16695a",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "指令体已用已合入原语表达并有真实执行证据（effect.mill（RIFT-112）按 441.1/441.2/441.4 把主牌库顶 3 张移到弃牌区，" +
    "牌库不足只烧得到的部分、被替代时 negated），阻断只在触发侧：" +
    "① hold 时点（383.4.d.2.b / 471.2 / 473.2.b）虽在 events/timing-points.ts 的封闭枚举中，" +
    "但 scoring/（RIFT-76）未接入 chain/events 单管线（RIFT-120），没有任何生产者发出 hold 时点；" +
    "② 没有已合入订阅方把 CardProgram 的 triggered ability 注册成 TriggerRegistration，190.6 的战场能力控制者解析缺失；" +
    "③ filter 的 here: true 是同类战场卡占位（053.3 的 here 指代），引擎 trigger-spec 校验器当前不接受该键。" +
    "依赖：RIFT-76 之后的 hold 发射与战场能力注册（契约 §7.2 批 5）。不近似实现。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "hold",
        // "here" 是本战场（053.3），"you" 是它的控制者（190.6.d）；
        // 同类战场程序沿用同一处占位写法，等待触发注册落地。
        filter: { event: "hold", here: true, player: "self" }
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
