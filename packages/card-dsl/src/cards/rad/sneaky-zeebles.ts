import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * rad-076-167 Sneaky Zeebles（能量 2、Power 无印刷值、Might 1、领域 Body、无标签）。
 *
 * 原文（逐字，已对照官方卡图）：
 *   "When I conquer, [Add] :rb_rune_rainbow:. (Abilities that add resources
 *    can't be reacted to.)"
 *
 * 规则依据（CR v1.5）：
 * - "When I conquer"：Conquer 触发（383.4.c / 471.1 / 383.4.c.1）；时点枚举里是 conquer
 *   （ruleRefs 468.5.d / 471.1 / 473.2.a），触发者为本来源单位。
 * - "[Add] :rb_rune_rainbow:"：430.1 的 Add 是把资源放进 Rune Pool；135.2.e.5 的
 *   rainbow 符号 = [A] = 任意领域的 Power，135.2.e.5.b 明确加到 Rune Pool 的 [A]
 *   可用来支付任意领域的 Power 费用。相对地 163.2.b 的 "Universal Power" 是另一回事
 *   （contract 3.6 的封闭 Domain 类型无法表示，effect.resources 文档也明确不接受）。
 *   这里印刷的是 [A]，不是 Universal。
 * - 提醒文本 "Abilities that add resources can't be reacted to"：430.2 / 430.2.a 说明
 *   Add 的触发/启动能力立即 finalize 并结算，且这一过程不传递 Priority 与 Focus；
 *   chain/engine.ts 已合入 ChainKind 'add'（advance() 在 Finalize 后立即 resolve、
 *   结算期间不 grantPriority/grantFocus），但"把 Add 触发注册成 kind: 'add' 而不是
 *   kind: 'triggered'"的生产绑定仍无调用方（triggerRegistrations 一律产出
 *   kind: 'triggered' 的草案），因此本卡仍走普通链。
 *
 * 状态：judge-required。三处当前真实缺口（2026-10-18 逐条实测）：
 * 1. rainbow（[A]）在封闭 Domain 类型里没有表示：card-dsl 的 Value/Domain 与
 *    effect.resources 的 DOMAINS 常量都只有 Fury/Calm/Mind/Body/Chaos/Order
 *    六域，effect.resources 对 ["rainbow"] 实测 negated/impossible；gain-power
 *    GameAction 的 power 也是 readonly Domain[]。要真正"加 1 点可支付任意领域的
 *    Power"，需要新增万能 Power 表示（见最终回复的契约变更请求）。
 * 2. Conquer 触发：订阅词已改为封闭词汇 "conquered"（写 "conquer" 会在
 *    registerTrigger 处被 invalid-event-type 拒绝；events/pipeline-match.ts 把时点
 *    conquer 映射成 conquered），订阅本身实测注册成功。但征服者身份仍拿不到：
 *    turn/flow.ts 的 scheduleScore 发布的 conquer 事件只带 player 与
 *    details.battlefieldId，不带 conquering Unit，也没有生产方补 object；
 *    绑定后的 filter { event: conquered, object: { objectId: self } } 实测不匹配该事件形状
 *    （matchesTriggerEvent 返回 false），因此"When I conquer"无法按 383.4.c.1 的
 *    "参与并成功征服该战场的单位"过滤；去掉 object 过滤又会把别人征服也算进来。
 * 3. 430.2 / 430.2.a 的"Add 能力立即 finalize 并结算、不传递 Priority 与 Focus"：
 *    ChainKind 'add' 与 advance() 的立即 resolve 已合入，但触发绑定链固定产出
 *    kind: 'triggered'，没有把 Add 触发升级为 kind: 'add' 的生产路径。
 * 依赖：万能 Power 契约、scoring 事件的征服单位身份、Add 触发的链草案种类。
 * 不近似实现：不把 [A] 近似成某一个具体领域（那会凭空限制可支付的费用），
 *   也不改写成 effect.channel / effect.draw。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "conquer",
      // 封闭词表用 "conquered"（时点仍是 conquer）；events/pipeline-match.ts 的
      // EVENT_NAMES 把 conquer 映射为 conquered，写 "conquer" 会在注册时被拒。
      filter: { event: "conquered", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        // 430.1 / 135.2.e.5：Add 1 Power of any domain。值是 [A] 的符号表示，
        // 不是六个 Domain 之一（见 judgeReason 的契约缺口）。
        id: "sneaky-zeebles.add-rainbow",
        op: "effect.resources",
        args: {
          power: { kind: "constant", value: ["rainbow"] },
          linkKey: { kind: "constant", value: "sneaky-zeebles.added" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId:
    "card.hash-36af4340a3b4308d5a0aaf002e73ae4fb29bec09c724487100a7387c8f819063",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处当前缺口（2026-10-18 实测），均不近似实现：" +
    "(1) [Add] :rb_rune_rainbow: 的 [A]（135.2.e.5 / 163.2.b，可支付任意领域的 Power）在封闭 Domain 类型里没有表示：" +
    "effect.resources 的 DOMAINS 与 gain-power GameAction 都只有六域，实测把 [\"rainbow\"] 交给 effect.resources 得到 " +
    "negated/impossible；要加 1 点「可支付任意领域」的 Power 需要新增万能 Power 表示，属契约缺口（见最终回复的契约变更请求）。" +
    "(2) 「When I conquer」的订阅词已按封闭词表改为 \"conquered\"（时点仍是 conquer；写 \"conquer\" 会在 registerTrigger " +
    "处被 invalid-event-type 拒绝），生产注册实测成功；但征服者身份（383.4.c.1）仍拿不到：" +
    "turn/flow.ts 的 scheduleScore 发布的 conquer 事件只带 player 与 details.battlefieldId，" +
    "不带 conquering Unit，也没有生产方补 object；绑定后的 filter { event: conquered, object: { objectId: self } } " +
    "实测不匹配该事件形状（matchesTriggerEvent 返回 false），而去掉 object 过滤会把其他单位的征服也算进来。" +
    "(3) 430.2 / 430.2.a 的「Add 能力立即 finalize 并结算、不传递 Priority 与 Focus」：ChainKind 'add' 与 " +
    "chain/engine.ts advance() 的立即 resolve 已合入，但 programs/triggers.ts 的 triggerRegistrations 固定产出 " +
    "kind: 'triggered' 草案，没有把 Add 触发绑定为 kind: 'add' 的生产路径。" +
    "golden 用六域之一的 gain-power 在测试内核里验证了同一原语路径（effect.resources 成功给 Rune Pool 加 1 点 Power、并链接实际增加量），" +
    "但该等价行为不覆盖 [A] 的领域自由度。",
  abilities,
  sourceText:
    "When I conquer, [Add] :rb_rune_rainbow:. (Abilities that add resources can't be reacted to.)"
} satisfies CardProgram;

export default program;
