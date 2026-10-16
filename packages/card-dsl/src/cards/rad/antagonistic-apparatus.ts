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
 * status: judge-required（不近似实现）：
 * - "I enter ready" 的入场替代管线（replacement.enter）未合入；
 * - "play a ready … token" 的入场就绪改写没有已合入的表达位置：effect.token 文档
 *   明确 “Entry overrides are not supported”（也不能用 effect.ready 事后补一次就绪）；
 * - mode "play" 的链上生成 + 打出需要链管线接手（当前参考内核 token "play" 路径可测，
 *   但入场状态改写仍缺）。
 *
 * 依赖：RIFT-83/RIFT-84（replacement.enter 入场替代）、RIFT-89~91（token 入场改写与
 * layers/continuous 管线）。
 */
const abilities: Ability[] = [
  {
    kind: "replacement",
    replaces: { event: "object-enters-board", filter: { source: "self", exhausted: true } },
    with: [{ id: "antagonistic-apparatus.enter-ready", op: "effect.ready", args: {} }]
  },
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        id: "antagonistic-apparatus.play-mech",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "mech" },
          amount: { kind: "constant", value: 1 },
          mode: { kind: "constant", value: "play" },
          location: { kind: "object-property", object: "source", property: "location" }
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
    "两个缺口：(1) “I enter ready”（143.4 默认横置进场 + 369.3 入场替代）需要" +
    "replacement.enter 入场替代管线，当前未合入（依赖 RIFT-83/RIFT-84）；已合入的" +
    "effect.ready 不能事后模拟入场状态（effect.ready 文件边界）。(2) “play a ready 3 " +
    ":rb_might: Mech unit token here” 的入场就绪改写没有可表达位置：effect.token 明确" +
    "不支持 entry override（143.4.a / 184.1 的 token 入场例外），也不能用 effect.ready " +
    "补一次就绪。Mech token 定义（187.4，id \"mech\"）与 mode \"play\"（440.2.c / 185.2.a）" +
    "已按契约声明。不近似实现。",
  abilities,
  sourceText: "I enter ready.\nWhen you play me, play a ready 3 :rb_might: Mech unit token here."
} satisfies CardProgram;

export default program;
