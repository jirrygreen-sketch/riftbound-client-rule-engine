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
 * status 判定（cards/README.md 第 2 节）：judge-required —— 三处缺口，均不近似实现：
 * 1. 触发无法送达：object-moved 时点由事件层定义，但 events/action-adapter.ts 为 move-location
 *    生成的事件不填 toZone/toKind（timing-points.ts 声明的 payloadFields），内层锚点 source: "self"
 *    也没有消费方；且 Tag 上没有 CardProgram → 触发注册的接线（sfd/apprentice-smith、
 *    sfd/ribbon-dancer 记录同一缺口，RIFT-120）。
 * 2. 关键词授予不可执行：effects/instructions/ 没有 continuous.grant-keyword 指令原语
 *    （ven/heart-of-the-tempest、ogn/block 同一缺口，RIFT-91），也没有「我的关键词」这一快照读数。
 * 3. 临时 Might 修正不可执行：契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，指令注册表里
 *    没有 continuous.might 原语，卡程序也没有把持续效果经 ResolveContext.addContinuous 落地的入口
 *    （unl/pridestalker、sfd/ribbon-dancer、ogn/sett-brawler 同一缺口；图层求值侧 RIFT-91 已合入）。
 * 不把 "equal to my Might" 写成常量，也不把临时修正近似成 Buff 计数器。
 * golden 只做身份/结构与已合入部分；未合入依赖写 test.todo。
 * 依赖：RIFT-120（移动时点载荷与卡牌触发注册）、RIFT-91（layers/持续效果消费）、RIFT-83/90（Deflect 展开与 target.tax）。
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
        // "my keywords"：来源当前关键词的授予；continuous.grant-keyword 未注册（见 judgeReason 第 2 点）。
        id: "kato-the-arm.grant-keywords",
        op: "continuous.grant-keyword",
        args: {
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
    "三处缺口，均不近似实现：(1) 触发无法送达——object-moved 事件虽有封闭时点，但 events/action-adapter.ts " +
    "为 move-location 生成的事件不填 toZone/toKind（timing-points.ts 声明的 payloadFields），toZone: \"battlefield\" " +
    "永不命中，内层锚点 source: \"self\" 也没有消费方，且没有 CardProgram → 触发注册的接线（RIFT-120；" +
    "sfd/apprentice-smith、sfd/ribbon-dancer 同一缺口）。(2)「give a friendly unit my keywords」需要 " +
    "continuous.grant-keyword 指令原语与「我的关键词」快照读数，指令注册表没有该 op（ven/heart-of-the-tempest、" +
    "ogn/block 同一缺口，RIFT-91）。(3)「+ :rb_might: equal to my Might this turn」是带本回合期限的临时 Might 修正：" +
    "契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，effects/instructions/ 也没有 continuous.might 原语，" +
    "卡程序没有经 ResolveContext.addContinuous 落地持续效果的入口（图层求值侧 RIFT-91 已合入；" +
    "unl/pridestalker、sfd/ribbon-dancer、ogn/sett-brawler 同一缺口）。不把 \"equal to my Might\" 写成常量，" +
    "也不把临时修正近似成 Buff 计数器（703）。[Deflect] 声明本身可校验，其 target.tax 展开的消费方属 RIFT-90/91。" +
    "依赖：RIFT-120（移动时点载荷与触发注册）、RIFT-91（持续效果消费）、RIFT-90（target.tax）。",
  abilities,
  sourceText:
    "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
    "When I move to a battlefield, give a friendly unit my keywords and +:rb_might: equal to my Might this turn."
} satisfies CardProgram;

export default program;
