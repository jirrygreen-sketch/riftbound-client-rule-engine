import type { CardProgram } from "../../ir/index.js";

/**
 * Ravenbloom Conservatory (sfd-215-221) — Battlefield, Rumble precon.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-215-221，逐字）:
 *   "When you defend here, reveal the top card of your Main Deck. If it's a
 *    spell, put it in your hand. Otherwise, recycle it."
 *
 * 规则依据（CR v1.5）:
 * - 383.4.f / 466.2："When you defend here" 是 Defend Effect——Battlefield 自身的
 *   触发式能力，订阅 defense-declared 时点（events/timing-points.ts，refs 466.2）。
 *   "here" 指本 Battlefield（053.3 的 here referent）。
 * - "reveal the top card of your Main Deck"：425.1/425.2.a 的 Reveal（牌留在主牌库，
 *   425.1.a.2），且是**牌库顶**的真子集——契约 3.6 要求按区域内真实顺序取，effect.reveal
 *   明确拒绝用 query 推断牌库顺序（"a subset of this zone requires upstream ordered picks;
 *   query order is not deck order"），因此通过 RIFT-358 的 zoneSlice 有序 picks
 *   传入，不能以静态字符串占位符冒充真实的牌库顶。
 * - "If it's a spell"：这是对**被展示的那张牌**的类型判断，不是玩家选择。Condition 的
 *   object-property 读取链接值里首个对象的 types 数组，operator "in" 判定左侧值是否属于
 *   右侧数组，因此 compare("spell" in types) 可直接表达该判别式（golden 有真实执行证据）；
 *   两个分支各写一条带 condition 的指令，不用 choice.mode（牌面没有玩家选择，且
 *   chain/engine.ts 的 assertFinalizationSurface 对 choice.mode 抛 ChainContractBlockedError）。
 * - "put it in your hand" 是 effect.zone 的 return-to-hand（056.1/056.2 归拥有者手牌）；
 *   "Otherwise, recycle it" 是 417.1/417.1.a/417.1.c 的 Recycle（回拥有者主牌库底）。
 *
 * status = judge-required：仍缺 defense-declared 的战斗事务产生方（RIFT-124）
 * 与 053.3 的 here 事件过滤表达。RIFT-358 已合入 zoneSlice 有序 picks、链接结果
 * picks 和 effect.reveal.pick Expr 解包；正文不再需要替换参数或预置分支选择。
 * golden 通过真实 ChainEngine 的 Finalize/Resolve 执行原始正文的两个互斥分支。
 */
export default {
  canonicalCardId: "card.hash-5a86b358540e9ab2512400c77f3291739c2aa6ccb7b537449298a640b02b0e82",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处依赖仍未合入，均不近似实现：(1) defense-declared 缺少战斗开始事务产生方（RIFT-124）；" +
    "(2) here（CR 053.3）需要「事件发生在本战场」的表达，EventPattern / ObjectFilter 与程序绑定仍拒绝 here 字段。" +
    "正文已可执行：RIFT-358 的 zoneSlice 在 Finalize 锁定牌库顶 1 张，effect.reveal 的 pick Expr 已可解包；" +
    "回手 pick 直接绑定 reveal.revealed，compare(spell in object-property(types)) 决定回手或 effect.recycle 回收。" +
    "golden 用未改写的正文通过 ChainEngine 验证展示、链接与两个分支，未以未知战斗事件近似触发。",
  sourceText:
    "When you defend here, reveal the top card of your Main Deck. If it's a spell, put it in your hand. Otherwise, recycle it.",
  abilities: [
    {
      kind: "triggered",
      // 466.2 / 383.4.f：Battlefield 自身的 Defend Effect；"here" 用描述性 here 占位符
      // 保留打印语义（见 judgeReason：该字段尚无词汇，校验器会拒绝）。
      trigger: { at: "defense-declared", filter: { event: "defense-declared", here: true, player: "controller" } },
      optional: false,
      body: [
        {
          // 425.1 / 425.2.a：展示主牌库顶 1 张（牌留在牌库，425.1.a.2）。牌库顶是有序位置，
          // 必须由上游有序 picks 提供（契约 3.6；effect.reveal 拒绝用 query 推断牌库顺序）。
          id: "ravenbloom.reveal",
          op: "effect.reveal",
          // effect.reveal 的 pick 是 PickSpec id；契约 3.2 要求 args 的值为 Expr，
          // 这里按契约写 Expr，已合入的链适配器负责解包。
          args: { pick: { kind: "constant", value: "ravenbloom.revealed-card" } },
          picks: [
            {
              id: "ravenbloom.revealed-card",
              options: [],
              ordered: true,
              selection: "all",
              zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 1 } }
            }
          ]
        },
        {
          // "If it's a spell, put it in your hand."：对被展示牌的类型判别，不是玩家选择。
          // object-property 读链接值的首个对象，in 判定 "spell" 是否属于该对象的 types 数组。
          id: "ravenbloom.to-hand",
          op: "effect.zone",
          linkedTo: "ravenbloom.reveal",
          condition: {
            kind: "compare",
            left: { kind: "constant", value: "spell" },
            operator: "in",
            right: {
              kind: "object-property",
              object: { linked: "ravenbloom.reveal" },
              property: "types"
            }
          },
          args: {
            pick: { kind: "constant", value: "ravenbloom.revealed-hand" },
            to: { kind: "constant", value: "hand" },
            amount: { kind: "constant", value: 1 }
          },
          picks: [
            {
              id: "ravenbloom.revealed-hand",
              options: [],
              ordered: true,
              selection: "all",
              linked: { kind: "linked-value", instructionId: "ravenbloom.reveal", key: "revealed" }
            }
          ]
        },
        {
          // "Otherwise, recycle it."：417.1/417.1.a/417.1.c 回拥有者主牌库底。条件取反，
          // 与上一条互斥（同一张牌只会走一条分支）。
          id: "ravenbloom.recycle",
          op: "effect.recycle",
          linkedTo: "ravenbloom.reveal",
          condition: {
            kind: "not",
            condition: {
              kind: "compare",
              left: { kind: "constant", value: "spell" },
              operator: "in",
              right: {
                kind: "object-property",
                object: { linked: "ravenbloom.reveal" },
                property: "types"
              }
            }
          },
          args: {
            objects: { kind: "linked-value", instructionId: "ravenbloom.reveal", key: "revealed" }
          }
        }
      ]
    }
  ]
} satisfies CardProgram;

