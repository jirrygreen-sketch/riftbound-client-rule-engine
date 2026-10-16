import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Sprite Queen (unl-084-219) — Unit, 7 energy + 1 Mind power，Might 6，Mind，
 * 标签 Fae/Ionia。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-084-219，逐字）：
 *   When you play me or at the start of your Beginning Phase, play a ready
 *   3 :rb_might: Sprite unit token with [Temporary] to your base. (Kill them at
 *   the start of their controller's next Beginning Phase, before scoring.)
 *
 * 规则依据（CR v1.5）：
 * - “When you play me”：383.4.a/420.4.a 的 Play Effect（时点 card-played，filter 指向自身）。
 * - “at the start of your Beginning Phase”：315.2.a.1 的阶段开始时点（封闭表 beginning-start）；
 *   190.6.d 的隐含 “you” 是能力控制者。“A or B” 的两个条件写为两条触发能力，
 *   二者共享同一段效果文本；两段条件互斥，不会同时命中。
 * - “play a ready 3 :rb_might: Sprite unit token with [Temporary]”：187.2 的 Sprite 是
 *   3 Might、无领域、Fae 标签、带 [Temporary] 的单位 token；440.2.c / 185.2.a / 350.2 /
 *   354 规定被“打出”的 token 先在链上生成，再由 play 动作接手。
 * - “to your base”：182/183/440.4 的 token 归属与控制者是能力控制者。
 *
 * status = judge-required（缺口均不近似实现）：
 * - Sprite token 定义（187.2）不在 effect.token 的冻结定义表内（recruit / sand-soldier /
 *   mech / reflection / tentacle）；带自身关键词的定义按原语文档保持 blocked（RIFT-62）。
 * - “ready” 是入场状态改写（143.4 / 184.1 / 185.2.d）：create-token / play 不支持入场状态
 *   覆盖，先创建再补一次 effect.ready 会产生错误的“成为就绪”事件，不近似实现。
 * - “to your base” 需要相对能力控制者的 LocationRef：effect.token 的 location 只接受字面
 *   LocationRef，卡程序没有构建 controller-base 的表达式形态（effect.move 有 "controller-base"，
 *   effect.token 没有；ogn/altar-to-unity 记录同一缺口）。
 * - [Temporary]（816）的关键词展开与 keyword→时点/链注册（RIFT-265 + RIFT-120）未接线，
 *   token 不会在其控制者 Beginning Phase 开始时被消灭。
 * 依赖：RIFT-62（token 定义表与入场状态）、RIFT-120（触发注册）、RIFT-265（Temporary）、
 * effect.token 的 controller-relative location 契约变更请求。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    // 383.4.a："When you play me"。
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "sprite-queen.play-sprite-on-play",
        op: "effect.token",
        args: {
          // 187.2：3 Might 的无领域 Sprite 单位 token（Fae 标签、[Temporary]）。
          token: { kind: "constant", value: "sprite" },
          amount: { kind: "constant", value: 1 },
          // 440.2.c / 185.2.a：被“打出”的 token 先在链上生成，再由 play 接手。
          mode: { kind: "constant", value: "play" },
          // "to your base"：控制者基地；placeholder 拼写与 ogn/altar-to-unity 一致，
          // 当前原语会 fail-closed（见文件头 status 说明）。
          location: { kind: "constant", value: { type: "base", player: "controller" } },
          linkKey: { kind: "constant", value: "spriteToken" }
        }
      }
    ]
  },
  {
    kind: "triggered",
    // 315.2.a.1："at the start of your Beginning Phase"（控制者的 Beginning Phase）。
    trigger: {
      at: "beginning-start",
      filter: { event: "beginning-start", player: "self" }
    },
    optional: false,
    body: [
      {
        id: "sprite-queen.play-sprite-at-beginning",
        op: "effect.token",
        args: {
          token: { kind: "constant", value: "sprite" },
          amount: { kind: "constant", value: 1 },
          mode: { kind: "constant", value: "play" },
          location: { kind: "constant", value: { type: "base", player: "controller" } },
          linkKey: { kind: "constant", value: "spriteToken" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-a97b1d53f5a78ced95c65e0fe9618e56618fed2e7c141b9fd84485c40632768f",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "四处缺口，均不近似实现：(1) Sprite token 定义（187.2：3 Might、无领域、Fae 标签、带 [Temporary]）不在 effect.token 的冻结定义表" +
    "（recruit/sand-soldier/mech/reflection/tentacle），带自身关键词的定义按原语文档保持 blocked（RIFT-62）。" +
    "(2)「ready」是入场状态改写（143.4 / 184.1 / 185.2.d）：create-token/play 不支持入场状态覆盖，先创建再补一次 effect.ready 会多出" +
    "「成为就绪」事件，不是同一语义。" +
    "(3)「to your base」需要相对能力控制者的 LocationRef：effect.token 的 location 只接受字面 LocationRef，" +
    "卡程序没有 controller-base 的表达式形态（effect.move 有 \"controller-base\"，effect.token 没有；ogn/altar-to-unity 同缺口）。" +
    "(4) [Temporary]（816）的关键词展开与 keyword→时点/链注册未接线（RIFT-265 定义 + RIFT-120 注册），token 不会在其控制者 Beginning Phase 开始时消灭。" +
    "已写出：card-played 与 beginning-start 两条触发 + effect.token（sprite 定义、mode play、控制者基地占位）。依赖：RIFT-62、RIFT-120、RIFT-265、effect.token 的 controller-relative location 契约变更请求。",
  abilities,
  sourceText:
    "When you play me or at the start of your Beginning Phase, play a ready 3 :rb_might: Sprite unit token with [Temporary] " +
    "to your base. (Kill them at the start of their controller's next Beginning Phase, before scoring.)"
} satisfies CardProgram;

export default program;
