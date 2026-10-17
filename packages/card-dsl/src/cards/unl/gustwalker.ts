import type { CardProgram } from "../../ir/index.js";

/**
 * Gustwalker (unl-075-219) — Unit，3 能量 + 1 Power、Might 3，Mind / Dog / Ionia。
 *
 * sourceText（packages/card-data/data/deck-catalog.json，unl-075-219，逐字）：
 *   [Hunt 2] (When I conquer or hold, gain 2 XP.)
 *   [Level 3][>] I have +1 :rb_might: and [Ganking]. (While you have 3+ XP, get
 *   the effect. A [Ganking] unit can move from battlefield to battlefield.)
 *
 * 规则依据（CR v1.5）：
 * - 823.1 / 823.1.c.1：Hunt 是触发式能力关键词，整句功能上等同「When I Conquer or
 *   Hold, my controller gains X XP.」；相应时点是 conquer / hold（471.1 / 471.2）。
 *   823.1.c.3：X 是 Hunt Value（本卡为 2）。823.2：多个 Hunt 来源的数值由 expandProgram
 *   求和后传给一次 Hunt 展开。
 *   整段能力文本都落在关键词定义里，按 README 第 5 节只声明关键词、不重写展开。
 * - 824.1.a / 824.1.b.1：Level 是依赖式关键词；从关键词到子句末整段是 Level Ability，
 *   功能上等同「只要你有 N 点或更多 XP，本牌获得 '[Text]'」。824.1.c / 824.1.d：
 *   控制者 XP 变化会即时让依赖能力 Active / Inactive。
 * - 依赖能力 [Text] 的两半：
 *   - "I have +1 :rb_might:" 是 479.4 算术层的持续修正；
 *   - "and [Ganking]" 是关键词授予（810：Ganking 为被动能力关键词，给标准移动增加
 *     战场到战场的许可，810.1.c.1 不移除原有选项）。
 *
 * status = judge-required（缺口不近似实现）：
 * 1. Hunt 的 conquer/hold：turn/flow 的 score 分支会以玩家为发射方发出 conquer/hold
 *    事件（不是拼写缺失），但事件载荷不带 object，[Hunt 2] 的 "When I"（self 归属）
 *    无法命中；Hunt 数值求和本身已由 expandProgram 实现。
 * 2. Level 依赖式关键词的展开仍不能读取玩家 XP：824.1.c 需要可求值的「控制者 XP ≥ N」谓词，
 *    合并 IR 的 Condition 只有 always/never/expression/compare/all/any/not，
 *    PlayerSnapshot.xp 没有进入 Expr / 谓词求值的路径（count 会静默数对象，不抛错）；
 *    824.1.c.1 / .d 的动态激活 / 失活依赖同一谓词。
 * 3. 静态绑定可注册 "+1 :rb_might:" 与 "[Ganking]" 的授予，但移动规则尚未把
 *    运行时授予的 Ganking characteristic 消费为战场到战场许可。
 * 依赖：Hunt 事件载荷、Level 的实时 XP 谓词、Ganking 移动许可消费接线。
 */
const gustwalker = {
  canonicalCardId: "card.hash-a232dcd643d13b743c5bad3125bacbefc6b2ef53b24aa91708ec80fc13447153",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：(1) Hunt 的 conquer/hold 事件在 turn/flow 的 score 分支以玩家为发射方存在（不是拼写缺失），但事件载荷不带 object，" +
    "[Hunt 2] 的 When I（self 归属）无法命中；Hunt 数值求和已由 expandProgram 实现；" +
    "(2) [Level 3][>] 依赖式关键词（824.1.b.1）仍不能读取玩家 XP：824.1.c / .d 需要可求值的控制者 XP ≥ 3 谓词与动态失活，" +
    "合并 IR 的 Condition 读不到 PlayerSnapshot.xp（count 只会静默数对象）；" +
    "(3) 静态绑定可注册 Might 与 Ganking 授予，但移动规则尚未把运行时授予的 Ganking " +
    "characteristic 消费为战场到战场许可。" +
    "依赖：Hunt 事件载荷、Level 实时 XP 谓词、Ganking 移动许可消费接线。",
  abilities: [
    { kind: "keyword", keyword: "hunt", value: 2 },
    {
      kind: "static",
      // 824.1.b.1：Level 3 的依赖能力 = 「控制者 XP ≥ 3 时本牌获得 [Text]」。
      // XP 谓词尚不能读取控制者的实时 XP（见 judgeReason），但静态绑定已能注册
      // continuous.might；这里按可审查的契约形状写出依赖能力的第一半。
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: 1 },
        appliesTo: "self"
      },
      condition: {
        kind: "compare",
        left: { kind: "count", subject: "controller-xp", filter: { player: "controller" } },
        operator: "gte",
        right: { kind: "constant", value: 3 }
      }
    },
    {
      kind: "static",
      // 依赖能力的第二半：「and [Ganking]」。
      effect: {
        kind: "continuous.grant-keyword",
        keyword: "Ganking",
        appliesTo: "self"
      },
      condition: {
        kind: "compare",
        left: { kind: "count", subject: "controller-xp", filter: { player: "controller" } },
        operator: "gte",
        right: { kind: "constant", value: 3 }
      }
    }
  ],
  sourceText:
    "[Hunt 2] (When I conquer or hold, gain 2 XP.)\n" +
    "[Level 3][>] I have +1 :rb_might: and [Ganking]. (While you have 3+ XP, get the effect. A [Ganking] unit can move from battlefield to battlefield.)"
} satisfies CardProgram;

export default gustwalker;
