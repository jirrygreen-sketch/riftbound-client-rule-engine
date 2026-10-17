import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Antagonistic Apparatus (rad-009-167) — Unit, domainless, 6 energy / 1 power / 3 Might.
 *
 * 原文（deck-catalog rad-009-167，逐字）：
 *   "I enter ready.\nWhen you play me, play a ready 3 :rb_might: Mech unit token here."
 *
 * 规则依据（CR v1.5）：
 * - "I enter ready."：单位默认横置进场（143.4），本句是入场替代（369.3 的
 *   “as a unit enters”写法；单位自身声明，无需条件）；
 * - "When you play me"：Play Effect（383.4.a）→ 时点 card-played、filter 自身；
 * - "play a ready 3 :rb_might: Mech unit token here"：
 *   - Mech 单位 token 是 CR 187.4 的 3 Might 定义，effect.token 定义表 id "mech"；
 *   - 新 token 由链上生成后打出（440.2.c、185.2.a、350.2、354），对应 effect.token 的
 *     mode: "play"，后续打出流程由链管线接手；
 *   - "here" = 打出本单位的位置；用 object-property 在结算时读来源位置
 *     （420.3.b.2 的结算时检查），object 用契约 3.6 符号选择器 "source"；
 *   - "ready" 是入场状态改写（143.4.a、184.1 的 token 入场例外）：入场替代由
 *     replacement.enter / 创建动作处理，effect.ready 明确不能事后模拟“enter ready”。
 *
 * Antagonistic Apparatus — CR v1.5 369.3 (self entry), 383.4.a (play effect),
 * 187.4 (3 Might Mech), 184.1 (token entry override), 440.2.c (Chain creation).
 * Self entry and the location-linked token body have partial execution evidence.
 * The ready token entry and production token Play remain blocked; see judgeReason.
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    replaces: { event: "object-enters-board", filter: { source: "self", exhausted: true } },
    // 369.3 / 805.6：入场替代把「横置入场」改写为「就绪入场」。body 用符号选择器
    // { kind: "source" }（replacement planner 绑定被替代事件的对象），不写运行时引用。
    with: [
      {
        id: "antagonistic-apparatus.enter-ready",
        op: "effect.ready",
        args: { objects: { kind: "constant", value: { kind: "source" } } }
      }
    ]
  },
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "antagonistic-apparatus.read-here",
        // "here" 在结算时读取来源位置（420.3.b.2），经链接值交给 token 的 location
        // （effect.token 的 args schema 不接受 object-property 形式，见 judgeReason）。
        op: "condition.value",
        args: {
          value: {
            kind: "object-property",
            object: "source",
            property: "location"
          },
          key: { kind: "constant", value: "here" }
        }
      },
      {
        id: "antagonistic-apparatus.play-mech",
        op: "effect.token",
        linkedTo: "antagonistic-apparatus.read-here",
        args: {
          token: { kind: "constant", value: "mech" },
          amount: { kind: "constant", value: 1 },
          mode: { kind: "constant", value: "play" },
          location: {
            kind: "linked-value",
            instructionId: "antagonistic-apparatus.read-here",
            key: "here"
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-a9bb0cc78cd6afeac937db36c78625e7d815c1cd4442e8115cc6f1243277c6d0",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "CR 184.1 / 143.4.a：effect.token 的 argsSchema 没有 exhausted/ready 入场覆盖，不能表达打出的 Mech token 就绪入场；自身的 replacement.enter 只绑定宿主，不能代替 token 的单次入场状态。CR 440.2.c / 185.2.a：ChainEngine 的 play 需要 describePlay，生产 EngineRuntimeHost 对 play 仍返回 impossible，缺无卡牌程序 token 的 play/Finalize 接线。",
  abilities,
  sourceText: "I enter ready.\nWhen you play me, play a ready 3 :rb_might: Mech unit token here."
} satisfies CardProgram;

export default program;
