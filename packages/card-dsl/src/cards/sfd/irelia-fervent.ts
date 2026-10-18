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
 *   became-target（events/timing-points.ts，ruleRefs 355.6/754）；chain/engine.ts 的
 *   TargetPlan finalize 会发出该事件并带 object/target/source/player 载荷。
 * - "or ready me"：「or」在这里是两个触发条件的并列，不是二选一的效果模式
 *   （355.11 的 "or" 只针对效果的并列模式；触发条件的 "or" 是并列订阅）。因此写成两条
 *   triggered 能力，分别订阅 became-target 与 object-readied（416/412.4 的 "becomes
 *   ready" 时点），两条共用同一效果体。
 * - "give me +1 :rb_might: this turn"：带回合期限的临时 Might 修改，属算术图层
 *   （continuous.might，143.2.a/475–477）；effect.buff 文件头明确临时 Might 修改归
 *   continuous.might，不是 Buff 计数器（702/703）。"me" 是能力宿主，用 continuous.might
 *   的 appliesTo: "self" 简写（契约 3.6 的符号选择器）。
 * - 427.1.c 的注意点："When you buff me" 类措辞依赖「真的被 Buff」；本卡的
 *   "choose" 是 Targeting Effect（触发于成为目标），"ready" 是 Ready 动作，两者的
 *   实际发生由时点发出方判定，卡不重复实现。
 * - 触发过滤器的锚点写"指称本卡"的可翻译拼写：objectId: "self" 由卡牌程序绑定
 *   （programs/filters.ts）翻译成 object: { objectId: <host ref> }，player: "self" 由事件匹配器
 *   解析为「该能力控制者」（events/pipeline-match.ts 的 playerMatches）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required（复核 2026-10-17）。
 * - 临时 Might 修改与两条触发都已可执行：continuous.might 经
 *   ResolveContext.addContinuous 注册 arithmetic 图层效果并按 this-turn 到期，
 *   卡牌程序绑定（programs/）把两条 triggered 能力注册成真实订阅；golden 用真实
 *   ChainEngine 执行 became-target（TargetPlan finalize 的实际发射形状）与
 *   object-readied（真实 ready 动作），断言 +1 有效 Might、非 Buff、回合结束到期与
 *   敌方指定不触发。
 * - 整卡仍不可执行：[Deflect]（809.1.a）的 KeywordDef 展开（static target.tax）与
 *   target/target-plan.ts 的 tax 追加（taxAdapter）都已合入，但没有生产方把永久物上的
 *   target.tax 接进目标选择：programs/statics.ts 的 layerFor 对 target.tax 抛
 *   ProgramBindingError（Static ability kind target.tax has no layer mapping），
 *   chain/engine.ts 只把调用方显式传入的 tax 变成 mandatoryAdditional，
 *   且已合入换算按 Energy 记账而 809.1.c.1 要求任意域 Power
 *   （与 ogn/pouty-poro 同一记录）。
 * 不近似实现（不用 Buff 计数代替临时 Might，也不把触发条件改成其它时点，
 * 更不省略 Deflect 的追加费用）。
 */
/** 两条触发（choose / ready）的同一印文效果："give me +1 :rb_might: this turn"。 */
const grantMight = (id: string): Instruction => ({
  id,
  op: "continuous.might",
  args: {
    amount: { kind: "constant", value: 1 },
    duration: { kind: "constant", value: "this-turn" },
    // "me" 是能力宿主：appliesTo 的符号简写，不写运行时 ObjectRef。
    appliesTo: { kind: "constant", value: "self" }
  }
});

const abilities: Ability[] = [
  { kind: "keyword", keyword: "deflect" },
  {
    kind: "triggered",
    // 383.4.b：Targeting Effect（"When you choose me …"），时点 became-target。
    trigger: { at: "became-target", filter: { event: "became-target", objectId: "self", player: "self" } },
    optional: false,
    body: [grantMight("irelia-fervent.choose-plus-1-might")]
  },
  {
    kind: "triggered",
    // 416/412.4："becomes ready" 时点 object-readied，锚点指向本卡自身。
    trigger: { at: "object-readied", filter: { event: "object-readied", objectId: "self", player: "self" } },
    optional: false,
    body: [grantMight("irelia-fervent.ready-plus-1-might")]
  }
];

const program = {
  canonicalCardId: "card.hash-cdc4606d9f9f7a0a63ed596fdbdee4a120ac153f9b1a74dd38db8c4c34616644",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "实测（2026-10-17）仅剩一处缺口：[Deflect]（809.1.a）的 KeywordDef 展开（effects/keywords/Deflect.ts 的 static " +
    "target.tax）与 target/target-plan.ts 的 tax 追加（taxAdapter → mandatoryAdditional）都已合入，" +
    "但没有生产方把永久物上的 target.tax 接进目标选择：programs/statics.ts 的 layerFor 对 " +
    "target.tax 抛 ProgramBindingError（no layer mapping，实测），" +
    "chain/engine.ts 只把调用方显式传入的 tax 变成 mandatoryAdditional，" +
    "且已合入换算按 Energy 记账而 809.1.c.1 要求任意域 Power（同 ogn/pouty-poro）。" +
    "其余已可执行并有真实执行测试：" +
    "(1)「give me +1 :rb_might: this turn」用已合入的 continuous.might 经 " +
    "ResolveContext.addContinuous 注册 arithmetic 图层效果、appliesTo: \"self\" 指称宿主并按 " +
    "this-turn 到期（317.1.a/468.7.c），绝不用 Buff 计数近似（702/703）；" +
    "(2) 两条触发（became-target，383.4.b；object-readied，416/412.4）经卡牌程序绑定 " +
    "（programs/）注册为真实订阅（实测 registerProgramTriggers 注册 2 条），golden 用真实 ChainEngine " +
    "执行 became-target 发射与真实 ready 动作。不近似实现（不省略 Deflect 的追加费用）。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "When you choose or ready me, give me +1 :rb_might: this turn."
} satisfies CardProgram;

export default program;
