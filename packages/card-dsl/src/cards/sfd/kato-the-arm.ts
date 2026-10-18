import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Kato the Arm (sfd-112-221) — Unit, 4 energy + 1 Body power, Might 3，
 * 领域 Body，标签 Noxus。
 *
 * sourceText（packages/card-data/data/deck-catalog.json sfd-112-221，逐字）：
 *   "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)
 *    When I move to a battlefield, give a friendly unit my keywords and +:rb_might:
 *    equal to my Might this turn."
 *
 * 规则依据（Core Rules v1.5）：
 * - [Deflect]（809.1.b.3 未写数值即 Deflect Value 1；809.1.c/809.1.d 是对选择本永久物的对手
 *   法术/能力追加的强制附加费用）：按 README 第 5 节只声明 { kind: "keyword", keyword: "deflect" }，
 *   展开归 effects/keywords/Deflect.ts（static target.tax），卡牌不重写。
 * - "When I move to a battlefield"（421.1、449.1/449.2；458/458.1 说明 Recall 不是 Move）：封闭时点
 *   用 "object-moved"，目的地用 toZone: "battlefield"，自身用内层锚点 source: "self"
 *   （与已合入 sfd/ribbon-dancer、sfd/corinna-veraza 同一写法）。
 * - "give a friendly unit my keywords and +:rb_might: equal to my Might this turn"：这是**同一个**被选
 *   单位的两个并列结果（同一句、同一个 "a friendly unit"），因此只声明一个 TargetSpec，第二条指令
 *   用该 TargetSpec id 读取同一组锁定目标，不另做第二次选择（对照 effect.buff/effect.kill 用 target
 *   id 指向已声明 TargetSpec 的写法）。
 * - "my keywords"：把来源当前拥有的关键词授予该单位，属图层的关键词授予（契约 3.4 的 ability
 *   图层，连续效果不进链）；它需要读取来源当前的关键词快照。
 * - "+ :rb_might: equal to my Might this turn"：带本回合期限的临时 Might 修正，属算术图层
 *   （continuous.might；effect.buff 文件头明确临时 Might 修改不属 Buff 计数），数值在结算时读
 *   来源的有效 Might（143.2.a）。既不是 Buff 计数，也不是「设值」。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required（复核 2026-10-17）——两处缺口：
 * 1. 触发无法注册：object-moved 虽在 timing-points.ts 的封闭时点表里（refs 421.1/449.1/
 *    449.2），但 trigger-spec.ts 的 EVENT_PATTERN_TYPES 没有 "object-moved"（只有
 *    "conquered"/"held"/…），RIFT-257 的 pipeline.registerTrigger → assertTriggerSpec 会在
 *    卡牌触发注册时报 invalid-event-type；本卡的 toZone: "battlefield" 过滤因此无法送达。
 *    需要事件词汇表补 "object-moved"（及 toKind/toZone 载荷匹配）后才能注册。
 * 2. 「my keywords」的描述性读法：指令体用 continuous.grant-keyword 运行时读取来源快照
 *    （RIFT-258 已合入 primitive），但由于 (1) 触发无法注册，整条能力无从进入链。
 * 已执行证据：两段效果（关键词授予 + Might 授予）经解释器真实注册 ability/arithmetic
 *    层效果并读到运行时值（golden 用链式查询归一化执行），但不构成整卡可执行。
 * 不把 "equal to my Might" 写成常量，也不把临时修正近似成 Buff 计数器。
 * 依赖：EVENT_PATTERN_TYPES 的 object-moved 词汇与移动事件载荷绑定。
 */
const abilities: Ability[] = [
  // 809.1.b.3：未写数值即 1，按 README 第 5 节省略 value，由关键词展开补默认值。
  { kind: "keyword", keyword: "deflect" },
  {
    kind: "triggered",
    trigger: {
      at: "object-moved",
      filter: {
        event: "object-moved",
        // 449.1/449.2：目的地是战场（载荷字段，见 judgeReason 第 1 点）。
        toZone: "battlefield",
        filter: { source: "self" }
      }
    },
    optional: false,
    body: [
      {
        // "my keywords"：来源当前关键词的授予；continuous.grant-keyword 本体已合入
        // 并经解释器执行（见下方 golden），整卡仍因触发无法注册而不可执行。
        id: "kato-the-arm.grant-keywords",
        op: "continuous.grant-keyword",
        args: {
          // 复用已锁定的同一 "a friendly unit" TargetSpec（355.5/355.7）：
          // continuous.grant-keyword 的选择参数按 spec id 读取锁定目标，
          // 缺省时会落到来源自身，不能表达「give a friendly unit」的受赠者。
          target: { kind: "constant", value: "kato-the-arm.friendly-unit" },
          // 读取来源自身的关键词特征（"my keywords"）。
          keywords: {
            kind: "object-property",
            object: "source",
            property: "keywords"
          },
          duration: { kind: "constant", value: "this-turn" }
        },
        targets: [
          {
            id: "kato-the-arm.friendly-unit",
            // 355.7/355.9.b："a friendly unit" 由玩家选定具体对象，是目标；"friendly" 即能力控制者。
            filter: { type: "unit", zone: "board", controller: "controller" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      },
      {
        // "+ :rb_might: equal to my Might this turn"：数值在结算时读来源的有效 Might（143.2.a）；
        // 作用对象与上一条是同一个已选单位（英文单句、同一个 "a friendly unit"）。
        id: "kato-the-arm.grant-might",
        op: "continuous.might",
        linkedTo: "kato-the-arm.grant-keywords",
        args: {
          // 复用上一条指令已锁定的同一 TargetSpec：不第二次选择，"it" 即该单位。
          target: { kind: "constant", value: "kato-the-arm.friendly-unit" },
          amount: {
            kind: "object-property",
            object: "source",
            property: "might"
          },
          mode: { kind: "constant", value: "add" },
          duration: { kind: "constant", value: "this-turn" }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-5c42b9538a43758dced9b213312dffeb6ebdd4fa21de3590ccf10cb802f80cd0",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "实测（2026-10-17）两处缺口，均不近似实现：(1) 触发无法注册——object-moved 是 events/timing-points.ts 的封闭时点" +
    "（refs 421.1/449.1/449.2，events/action-adapter.ts 也为 move-location 发出该事件），但 events/trigger-spec.ts " +
    "的 EVENT_PATTERN_TYPES 封闭词汇表没有 \"object-moved\"，pipeline.registerTrigger → assertTriggerSpec " +
    "会在注册本卡触发时报 invalid-event-type（实测 registerProgramTriggers 抛 TriggerSpecValidationError），" +
    "toZone: \"battlefield\" 过滤无从匹配（需要：词汇表成员与事件载荷的 toKind/toZone 字段）。(2) 由于 (1)，" +
    "「my keywords」经 continuous.grant-keyword 的运行时读取与「+ my Might」的 continuous.might 都到不了结算；" +
    "两段体已用解释器 + 链式查询归一化真实执行注册（ability/arithmetic 层、this-turn 期限），但不构成整卡执行证据。" +
    "不把 \"equal to my Might\" 写成常量，也不把临时修正近似成 Buff 计数器（703）。" +
    "[Deflect] 声明本身可校验，其 target.tax 展开没有生产消费方（programs/statics.ts 的 layerFor 抛 no layer mapping），" +
    "且结算换算按 Energy 记账而 809.1.c.1 要求任意域 Power。" +
    "依赖：EVENT_PATTERN_TYPES 的 object-moved 词汇与移动载荷绑定 + target.tax 的 statics 接线。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "When I move to a battlefield, give a friendly unit my keywords and +:rb_might: equal to my Might this turn."
} satisfies CardProgram;

export default program;
