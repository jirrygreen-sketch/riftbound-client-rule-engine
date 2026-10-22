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
 * status = executable（复核 2026-10-21）：CombatFlow 的原子 Combat start
 * 已同时建立 Attacker/Defender 并发布 defense-declared（466.2/323.2）；
 * EventPattern/ObjectFilter 的 here 已由 pipeline-match 按事件
 * details.battlefieldId 与触发来源位置求值（053.3）。RIFT-358 的 zoneSlice
 * 有序 picks、链接结果 picks 和 effect.reveal.pick Expr 解包也已合入。
 * production golden 通过 ProgramBinding lifecycle、TurnFlow/CombatFlow 与
 * ChainEngine Finalize/Resolve 执行原始正文的两个互斥分支，并验证在另一
 * 战场发生的 defense-declared 不会触发本战场。
 */
export default {
  canonicalCardId: "card.hash-5a86b358540e9ab2512400c77f3291739c2aa6ccb7b537449298a640b02b0e82",
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText:
    "When you defend here, reveal the top card of your Main Deck. If it's a spell, put it in your hand. Otherwise, recycle it.",
  abilities: [
    {
      kind: "triggered",
      // 466.2 / 383.4.f：Battlefield 自身的 Defend Effect；"you" 是能力控制者
      // （190.6.d），用封闭的 PlayerSelector "self" 表达。"here" 是当前战场
      // 相对锚；EventPipeline 将事件 details.battlefieldId 与触发来源当前位置
      // 比较，只在本 Battlefield 防守时命中（053.3）。
      trigger: { at: "defense-declared", filter: { event: "defense-declared", here: true, player: "self" } },
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

