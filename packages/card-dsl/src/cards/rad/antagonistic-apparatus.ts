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
 * - “I enter ready” 的入场替代管线（RIFT-260 replacement.enter / replacement 绑定）已合入，
 *   replacement 能力体因此改为 canonical 形状（effect.ready 的 objects 用符号选择器
 *   { kind: "source" }，由 replacement planner 绑定被替代事件的对象）；golden 用真实
 *   bindReplacement + 链内出场执行该替代。整卡仍缺：
 * - “play a ready … token” 的入场就绪改写没有已合入的表达位置：effect.token 文档
 *   明确 “Entry overrides are not supported”（也不能用 effect.ready 事后补一次就绪）；
 * - mode "play" 的链上生成 + 打出在生产链还需要 CardProgram → TriggerRegistration /
 *   打出适配器（RIFT-257）；
 * - “here” 的静态表达：effect.token 的 args schema 不接受 object-property 位置，
 *   本程序按已合入条件指令换成 condition.value 读出位置再以 linked-value 交给 token
 *   （contract 3.9 链接形状）。
 *
 * 依赖：token 入场状态改写、RIFT-257 CardProgram 绑定。
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
    "(1) “play a ready 3 :rb_might: Mech unit token here” 的入场就绪改写没有可表达位置：" +
    "effect.token 明确不支持 entry override（143.4.a / 184.1 的 token 入场例外），也不能用 " +
    "effect.ready 事后补一次就绪（会多一次状态事件并错过入场替代）；(2) mode \"play\" 的链上" +
    "生成 + 打出在生产链需要 CardProgram 绑定与打出适配器（RIFT-257）。Mech token 定义" +
    "（187.4，id \"mech\"）与 mode \"play\"（440.2.c / 185.2.a）按契约声明；“I enter ready”" +
    "（143.4 + 369.3）改用已合入的 replacement.enter 形状（RIFT-260）并有真实绑定执行测试；" +
    "“here” 用 condition.value 读取来源位置后经 linked-value 交给 token（effect.token 的" +
    "位置参数不接受 object-property 形式）。不近似实现。",
  abilities,
  sourceText: "I enter ready.\nWhen you play me, play a ready 3 :rb_might: Mech unit token here."
} satisfies CardProgram;

export default program;
