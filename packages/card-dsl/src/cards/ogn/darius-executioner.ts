import type { CardProgram } from "../../ir/index.js";

/**
 * Darius, Executioner (ogn-243-298) — Unit, Order, M1 卡组 (fiora-sfd)。
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-243-298):
 *   [Legion] — When you play me, ready me. (Get the effect if you've played
 *   another card this turn)
 *   Other friendly units have +1 :rb_might: here.
 *
 * 第一条语句是 [Legion] 的依赖能力（CR v1.5 812.1.b：从关键词到子句结束整句都是
 * Legion 能力，[Text] 是依赖能力；812.1.b.1 功能上等价于「本回合你已打出过另一张牌
 * 时，本卡获得 [Text]」）。
 * - Legion 按契约 3.7 用 { kind: "keyword", keyword: "legion" } 声明：
 *   effects/keywords/Legion.ts（RIFT-82 合入）展开为 condition.predicate 静态谓词。
 *   该谓词使用的 HistoryQuery 排除维度（excluding，812.1.c 要求排除本卡自身）在
 *   封闭的 HistoryQuery 结构里不存在，Legion 文件自己标注为契约级缺口。
 * - [Text]「When you play me, ready me.」是打出触发（383.4.a Play Effect，时点
 *   card-played），指令体是已合入的 effect.ready 原语（416.1/416.1.c，缺省即"重置
 *   来源"= 重置我）。"ready me" 不改写成 enter-ready 替代：359.2.c 规定单位横置入场，
 *   这里是结算时的 reset 动作。
 *   订阅侧仍缺件：没有任何模块把 CardProgram 的 triggered ability 注册成
 *   TriggerRegistration（383.4.a.2 要求 Play Effect 进链），所以这条触发当前只声明形状。
 * - 第二条「Other friendly units have +1 :rb_might: here.」是 479.4 算术层的持续
 *   修正（479.2.b/479.3.b 的 "have" 指能力授予，Might 数值落在 479.4）：范围是
 *   "other"（排除本源自身）+ "friendly"（740.1.a 同控制者）+ "here"（本源当前
 *   位置，479.4.b 被动能力不做 snapshot，按结算时状态计算）。`here` 用契约 3.6 的
 *   锚点 sameLocationAs: "source" 表达，自身用 exclude: "source" 排除。
 *   但 layers/filter.ts 的 matchesObjectFilter 既不解析 controller: "controller"
 *   占位（按字面量与对象 controller 比较，永不相等），也不实现 sameLocationAs /
 *   exclude 锚点（按未知键忽略），而且没有把卡牌程序的 static 能力注册进
 *   LayerEngine 的路径，所以 +1 Might 与 "here" 范围都暂不可执行。
 *
 * 整卡 judge-required：Legion 依赖（812.1.c 的按卡排除）与第二条静态修正都还不能
 * 落地；card-played 触发是触发管线（383.4.a.2 要求进链）职责，本卡只声明形状。
 */
const dariusExecutioner = {
  canonicalCardId: "card.hash-e6a58258933ab19a3c7228a2f9c1ca8bc777a3d378b3ee92ae1b4deca50792b9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Legion]（812.1.b.1）的展开依赖 effects/keywords/Legion.ts（RIFT-82 已合入）里的 condition.predicate，" +
    "而其历史条件需要按 812.1.c 排除本卡自身——封闭 HistoryQuery（scope/action/timingPoint/player/object）没有按卡身份" +
    "排除的字段，Legion 文件自己标注为契约级缺口；第二条「Other friendly units have +1 :rb_might: here.」是 479.4 " +
    "算术层持续修正，但 layers/filter.ts 的 matchesObjectFilter 既不解析 controller 占位（按字面量比较，永不匹配），" +
    "也不实现 sameLocationAs / exclude 锚点，且没有把卡牌 static 能力注册进 LayerEngine 的路径，因此 +1 Might 与 " +
    "'here' 范围都无法执行；打出触发的 ready me 结构完整（effect.ready 已合入），但还没有把 CardProgram 的 " +
    "triggered ability 注册成 TriggerRegistration 的订阅方（383.4.a.2 的 Play Effect 进链），整卡不得因此标记 " +
    "executable。依赖：RIFT-82（kw-deathknell-legion）、RIFT-91（layers-continuous）、events/chain 触发订阅任务。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "legion" },
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { source: "self", player: "controller" } }
      },
      optional: false,
      body: [
        {
          id: "darius.ready-self",
          op: "effect.ready",
          args: {}
        }
      ]
    },
    {
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: 1 },
        // "Other friendly units ... here."：同控制者、本源当前位置、排除本源自身。
        filter: {
          type: "unit",
          controller: "controller",
          zone: "board",
          sameLocationAs: "source",
          exclude: "source"
        }
      }
    }
  ],
  sourceText:
    "[Legion] — When you play me, ready me. (Get the effect if you've played another card this turn)\n" +
    "Other friendly units have +1 :rb_might: here."
} satisfies CardProgram;

export default dariusExecutioner;
