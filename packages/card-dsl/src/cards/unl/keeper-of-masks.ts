import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Keeper of Masks (unl-081-219) — Unit, 2 energy, 无印刷力量，Might 1，Mind，标签 Ionia。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-081-219，逐字）：
 *   [Hidden] (Hide now for :rb_rune_rainbow: to react with later for
 *   :rb_energy_0:.)
 *   [Temporary] (Kill me at the start of my controller's Beginning Phase,
 *   before scoring.)
 *   When you play me, play two Reflection unit tokens here. They become copies
 *   of me.
 *
 * 规则依据（CR v1.5）：
 * - [Hidden]（811.1）是 Hide 自由行动的许可关键词，卡内只声明 keyword（契约 3.1/3.7），
 *   展开归 effects/keywords/Hidden.ts。
 * - [Temporary]（816.1）是触发能力关键词，816.1.b 的功能等价文本是「在该永久物控制者的
 *   Beginning Phase 开始时、计分前消灭它」，同样只声明。
 * - “When you play me”：383.4.a/420.4.a 的 Play Effect，时点 card-played，filter 指向自身。
 * - “play two Reflection unit tokens here”：187.6 的 Reflection 是 0 Might 的无领域单位
 *   token，对应 effect.token 定义表的 "reflection"；440.2.c/185.2.a 规定被“打出”的 token
 *   先在链上生成，再由 play 动作接手。
 * - “here”（464.2.b / 359.3.f.1）是打出本单位的位置，用契约 3.6 的符号选择器在结算时读取
 *   来源当前位置。
 * - “They become copies of me”：把复制特征施加到刚打出的两个 token 上（446/479.1 复制图层），
 *   不是另造对象。
 *
 * status = judge-required（缺口均不近似实现）：
 * - Hide 行动与面朝下打出需要 cost.hidden 与 continuous.timing 的消费方（RIFT-89、RIFT-91）：
 *   effects/keywords/Hidden.ts 只声明静态 cost.hidden，没有指令或图层读取它。
 * - [Temporary]（816）的关键词展开与「keyword 能力 → 时点/链」注册路径未接线
 *   （RIFT-265 的定义 + RIFT-120 的触发注册），token 身上的 Temporary 不会真的在控制者
 *   Beginning Phase 开始时消灭它。
 * - “They become copies of me” 需要复制图层消费一个针对已存在对象的复制效果：effect.copy 的
 *   mode "effect" 在当前内核被显式阻断（blockedReason:
 *   copy-layer-traits-exceptions-and-attachment-duration-unavailable），用 mode "create" 直接
 *   造副本会跳过“先打出 Reflection token”这一步（187.6/440.2.c），不是同一语义。
 * - effect.token 的 argsSchema 尚未与契约 3.6 同步：object-property 的 object 只接受运行时
 *   ObjectRef，符号选择器会被拒绝（sfd/industrious-mechsmith 记录同一缺口，RIFT-62）。
 * 已保留的有依据形状：关键词声明 + card-played 自发触发 + effect.token（reflection、mode play、
 * here = 来源当前位置）+ 作用于链接结果的对象复制指令。
 *
 * 依赖：RIFT-89（cost.hidden/Hide）、RIFT-91（layers/continuous.timing 与复制图层消费方）、
 * RIFT-120（触发注册）、RIFT-265（Temporary 关键词展开）、RIFT-62（effect.token 参数同步）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "hidden" },
  { kind: "keyword", keyword: "temporary" },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "keeper-of-masks.play-reflections",
        op: "effect.token",
        args: {
          // 187.6：0 Might 的无领域 Reflection 单位 token。
          token: { kind: "constant", value: "reflection" },
          amount: { kind: "constant", value: 2 },
          // 440.2.c / 185.2.a：被“打出”的 token 先在链上生成，再由 play 接手。
          mode: { kind: "constant", value: "play" },
          // “here” = 来源当前所在位置（464.2.b）；符号选择器的形状见文件头缺口说明。
          location: { kind: "object-property", object: "source", property: "location" },
          linkKey: { kind: "constant", value: "reflections" }
        }
      },
      {
        // “They become copies of me”：对刚打出的两个 token 施加复制效果（446/479.1），
        // 复制图层的消费方未接线（见文件头 status 说明）；linkKey 的 objects 由前一条
        // 指令按契约 3.6 的链接值形状写入。
        id: "keeper-of-masks.become-copies",
        op: "effect.copy",
        linkedTo: "keeper-of-masks.play-reflections",
        args: {
          source: { kind: "constant", value: "self" },
          mode: { kind: "constant", value: "effect" },
          onto: { kind: "constant", value: { linked: "reflections.objects" } },
          duration: { kind: "constant", value: "permanent" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-ee62f6483d21027818d871161b12548f7f6c3e445b4af424782a65577bec4825",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处缺口，均不近似实现：(1) [Hidden]（811.1）的 Hide 行动与面朝下打出需要 cost.hidden 与 continuous.timing 的消费方" +
    "（effects/keywords/Hidden.ts 只声明静态 cost.hidden，没有指令/图层读取它；RIFT-89、RIFT-91）。" +
    "(2) [Temporary]（816）的关键词展开与 keyword→时点/链注册路径未接线（RIFT-265 的关键词定义 + RIFT-120 的触发注册），" +
    "token 的 Temporary 不会在控制者 Beginning Phase 开始时消灭它。" +
    "(3)「They become copies of me」需要对刚打出的 Reflection token 施加复制效果（446/479.1 复制图层）：effect.copy 的 " +
    "mode \"effect\" 在当前内核被显式阻断（blockedReason: copy-layer-traits-exceptions-and-attachment-duration-unavailable），" +
    "而用 mode \"create\" 直接创建副本会跳过原文先 play Reflection token 的流程（187.6/440.2.c），不是同一语义。" +
    "另外 effect.token 的 argsSchema 尚未与契约 3.6 同步（object-property 的 object 只接受运行时 ObjectRef，符号选择器被拒绝；" +
    "sfd/industrious-mechsmith 同缺口，RIFT-62）。" +
    "已保留：关键词声明 + card-played 自发触发 + effect.token（reflection 定义、mode play、here = 来源当前位置）+ 作用于链接结果的复制指令。" +
    "依赖：RIFT-89、RIFT-91、RIFT-120、RIFT-265、RIFT-62。",
  abilities,
  sourceText:
    "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
    "[Temporary] (Kill me at the start of my controller's Beginning Phase, before scoring.)\n" +
    "When you play me, play two Reflection unit tokens here. They become copies of me."
} satisfies CardProgram;

export default program;
