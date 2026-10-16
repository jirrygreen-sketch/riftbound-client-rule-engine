import type { Ability, CardProgram, Instruction } from "../../ir/index.js";

/**
 * Irelia, Fervent (sfd-057-221) — Unit, Calm, Irelia/Ionia/Champion.
 * energy 5, power: none printed, Might 4.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-057-221，逐字）:
 *   "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n"
 *   "When you choose or ready me, give me +1 :rb_might: this turn."
 *
 * 规则依据（CR v1.5）:
 * - [Deflect]（809）：被动能力关键词；809.1.b.3 省略数值按 1，卡只声明 keyword，展开
 *   （static target.tax）由 effects/keywords/Deflect.ts 负责。
 * - "When you choose ... me"：383.4.b 的 Targeting Effect——Conditions 里包含「某个
 *   Game Object 成为目标」；383.4.b.1 的常见措辞正是 "When you choose me …"，
 *   383.4.b.2 规定它在法术/能力指定合适目标后作为 Pending Item 进链。对应封闭时点
 *   became-target（events/timing-points.ts，ruleRefs 355.6/754）。
 * - "or ready me"：「or」在这里是两个触发条件的并列，不是二选一的效果模式
 *   （355.11 的 "or" 只针对效果的并列模式；触发条件的 "or" 是并列订阅）。因此写成两条
 *   triggered 能力，分别订阅 became-target 与 object-readied（416/412.4 的 "becomes
 *   ready" 时点），两条共用同一效果体。
 * - "give me +1 :rb_might: this turn"：带回合期限的临时 Might 修改，属算术图层
 *   （continuous.might，143.2.a/475–477）；effect.buff 文件头明确临时 Might 修改归
 *   continuous.might，不是 Buff 计数器（702/703）。"me" 指能力宿主，用契约 3.6 的
 *   符号选择器 "self"。
 * - 427.1.c 的注意点："When you buff me" 类措辞依赖「真的被 Buff」；本卡的
 *   "choose" 是 Targeting Effect（触发于成为目标），"ready" 是 Ready 动作，两者的
 *   实际发生由时点发出方判定，卡不重复实现。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 临时 Might 修改在结算期没有可执行路径：契约 3.6 的封闭 GameAction 集合没有
 *   Might 修改动作，effects/instructions/ 下也没有注册的 continuous.might 原语
 *   （层引擎能求值 arithmetic 层与回合期限，但没有把结算期的持续效果经
 *   ResolveContext.addContinuous 落地的指令）；不能近似为 effect.buff 计数。
 * - became-target 与 object-readied 时点已定义，但没有已合入消费方把 CardProgram 的
 *   triggered 能力注册成事件订阅（RIFT-120），两条触发都无法进链。
 * - [Deflect] 的展开（static target.tax）已合入，但没有生产方把永久物上的 target.tax
 *   接进目标选择与追加费用，且已合入换算按 Energy 记账而 809.1.c.1 要求任意域 Power
 *   （与 ogn/pouty-poro 同一记录）。
 * 依赖：continuous.might 指令原语（RIFT-9 清单；RIFT-91 的图层求值侧已合入）、
 * RIFT-120（转移/就绪时点的卡牌触发注册）、RIFT-90/RIFT-89（Deflect 目标税）。
 * 不近似实现（不用 Buff 计数代替临时 Might，也不把触发条件改成其它时点）。
 */
/** 两条触发（choose / ready）的同一印文效果："give me +1 :rb_might: this turn"。 */
const grantMight = (id: string): Instruction => ({
  id,
  op: "continuous.might",
  args: {
    amount: { kind: "constant", value: 1 },
    duration: { kind: "constant", value: "this-turn" }
  }
});

const abilities: Ability[] = [
  { kind: "keyword", keyword: "deflect" },
  {
    kind: "triggered",
    // 383.4.b：Targeting Effect（"When you choose me …"），时点 became-target。
    trigger: { at: "became-target", filter: { event: "became-target", target: { source: "self" } } },
    optional: false,
    body: [grantMight("irelia-fervent.choose-plus-1-might")]
  },
  {
    kind: "triggered",
    // 416/412.4："becomes ready" 时点 object-readied，filter 指向本卡自身。
    trigger: { at: "object-readied", filter: { event: "object-readied", filter: { source: "self" } } },
    optional: false,
    body: [grantMight("irelia-fervent.ready-plus-1-might")]
  }
];

const program = {
  canonicalCardId: "card.hash-cdc4606d9f9f7a0a63ed596fdbdee4a120ac153f9b1a74dd38db8c4c34616644",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "两处依赖未合入：(1)「give me +1 :rb_might: this turn」是带回合期限的临时 Might 修改，属算术图层：" +
    "契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，effects/instructions/ 下没有注册的 continuous.might 原语" +
    "（layers 能求值 arithmetic 层与 end-of-turn/this-turn 期限，但没有把结算期持续效果经 ResolveContext.addContinuous 落地的指令；" +
    "effect.buff 文件头明确临时 Might 归 continuous.might，不能近似为 Buff 计数）。" +
    "(2) Checking Effect 的两条订阅（became-target，383.4.b/754；object-readied，416/412.4）时点已定义，" +
    "但没有已合入消费方把 CardProgram 的 triggered 能力注册成事件订阅（CardProgram → TriggerRegistration，RIFT-120），触发无法进链。" +
    "(3)[Deflect] 的展开（static target.tax）已合入，但没有生产方把永久物上的 target.tax 接进目标选择与追加费用，" +
    "且已合入换算按 Energy 记账而 809.1.c.1 要求任意域 Power（同 ogn/pouty-poro，RIFT-90/RIFT-89）。" +
    "依赖：continuous.might 指令原语（RIFT-9 清单；RIFT-91 的图层求值侧已合入）、RIFT-120、RIFT-90/RIFT-89。不近似实现。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "When you choose or ready me, give me +1 :rb_might: this turn."
} satisfies CardProgram;

export default program;
