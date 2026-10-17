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
 *   effects/keywords/Legion.ts 展开为 condition.predicate 静态谓词。
 *   HistoryQuery 已支持 exclude: self，按实体排除本卡并保留同名的其他牌；
 *   关键词仍输出旧 excluding: canonicalCardId，且静态谓词与依赖触发未接线。
 * - [Text]「When you play me, ready me.」是打出触发（383.4.a Play Effect，时点
 *   card-played），指令体是已合入的 effect.ready 原语（416.1/416.1.c，缺省即"重置
 *   来源"= 重置我）。"ready me" 不改写成 enter-ready 替代：359.2.c 规定单位横置入场，
 *   这里是结算时的 reset 动作。
 *   触发注册路径已合入；当前剩余问题是 Legion predicate 的历史消费，而不是
 *   CardProgram triggered ability 的注册。
 * - 第二条「Other friendly units have +1 :rb_might: here.」是 479.4 算术层的持续
 *   修正（479.2.b/479.3.b 的 "have" 指能力授予，Might 数值落在 479.4）：范围是
 *   "other"（排除本源自身）+ "friendly"（740.1.a 同控制者）+ "here"（本源当前
 *   位置，479.4.b 被动能力不做 snapshot，按结算时状态计算）。`here` 用契约 3.6 的
 *   锚点 sameLocationAs: "source" 表达，自身用 exclude: "source" 排除。
 *   但 static binder 会拒绝 exclude: "source"，而 layers/filter.ts 的匹配路径也
 *   没有静态 other + here 的动态范围；sameLocationAs 也只在绑定时锁定位置。
 *
 * 整卡 judge-required：Legion 依赖（812.1.c 的按卡排除）与第二条静态修正都还不能
 * 落地；card-played 触发是触发管线（383.4.a.2 要求进链）职责，本卡只声明形状。
 */
const dariusExecutioner = {
  canonicalCardId: "card.hash-e6a58258933ab19a3c7228a2f9c1ca8bc777a3d378b3ee92ae1b4deca50792b9",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺 Legion 的 condition.predicate 静态历史谓词到依赖触发的消费路径（CR 812.1.b.1/812.1.c）：" +
    "HistoryQuery 已支持 exclude:self，但关键词仍输出 excluding:canonicalCardId，且 ready 触发未绑定该门槛；" +
    "还须对齐本回合 Finalize 历史及重置。另缺 479.4 的动态 other+here 光环：" +
    "static binder 拒绝 exclude:source，sameLocationAs 和 controller 仅在绑定时取值，不能随来源位置/控制权变化重算友方同地的其他单位。",
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
