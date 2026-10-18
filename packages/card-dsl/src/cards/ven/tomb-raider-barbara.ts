import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Tomb-Raider Barbara (ven-037-166) — Unit, Calm, 4 Energy, Might 4, tag Shurima.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-037-166，逐字）：
 *   When you play me, if you control 7 or more runes, choose an enemy gear. If it's
 *   [Empowered], disempower it. Otherwise, kill it.
 *
 * 规则依据（Core Rules v1.5）：
 * - 383.4.a / 383.4.a.1："When you play me" 是 Play Effect；封闭时点 "card-played"
 *   （events/timing-points.ts，ruleRefs 359/383.4.a/407），filter 用契约 3.6 的
 *   source: "self" 指称本卡。
 * - 383.2.a / 383.2.a.1：紧跟触发条件的 "if you control 7 or more runes" 属于触发条件
 *   （规则原文的 Sona, Harmonious 例即此形状），因此写在 trigger.condition 上；
 *   "you control" 的隐含 “you” 是能力控制者（190.6.d），133.5.a.1 / 431.1 让已 channel
 *   的符文留在控制者的符文区，故计数为符文区中 rune 数量 >= 7。
 * - 355.5 / 355.7 / 355.9.a.1 / 355.9.b："choose an enemy gear" 是选择具体游戏对象，
 *   且对手的 Board 是公开信息（355.10.a.1），因此是被选目标（TargetSpec），不是 pick。
 * - 443.1 / 443.1.a / 443.1.b / 443.2：Disempower 只影响当前 Empowered 的对象；对象有多个
 *   Empowered 状态时移除一个。effect.empower 的 mode: "disempower" 正是该 Limited Action 的
 *   入口（442/443 同文件）。
 * - 429.1 / 429.2.a / 429.3：Kill 是永久物从场上进入弃牌堆的动作，只有起点在 Board 才成立，
 *   且是 Limited Action；effect.kill 覆盖主动消灭。
 * - "If it's [Empowered], disempower it. Otherwise, kill it."：分支读的是选定目标的当前
 *   Empowered 状态（442.2/443.1.a），两条分支互斥，因此用两条各自带条件的指令绑定同一个
 *   TargetSpec（Finalize 只选一次；同 ogn/solari-chief 的 stunned 分支写法）。
 *
 * status = judge-required（复核 2026-10-17；唯一缺口不近似实现）：
 * 1. 分支判别器仍无法从卡程序求值：442.1.a/442.2 的 Empowered 状态由参考内核/动作层计数
 *   （test-kernel 的 MutableObject.empowered；empower 动作自增、disempower 清零），但
 *   effects/contract.ts 的 ObjectSnapshot 没有 empowered 字段（只有 buffs），生产 host
 *   （apps/game-server 的 empower 动作把它记在 buffs 上）拿不到该读数；本任务实测在
 *   参考内核里 object-property target.empowered 可正确求值 true/false 并驱动两条互斥分支，
 *   但把快照按契约字段裁剪后同一条件抛 MissingInformation("Unavailable characteristic:
 *   empowered")。因此卡内改用 condition.value 冻结读数 + linked-value 比较（可审查、可执行、
 *   缺读数时 fail closed），整卡仍因生产快照缺特征而保持 judge-required。
 * card-played 时点和 CardProgram 的 triggered binding 已合入；不再把触发注册列为缺口。
 * 依赖：ObjectSnapshot 声明 Empowered 状态特征（契约变更请求）。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } },
      // 383.2.a.1：紧跟触发条件的符文数量条件属于 Trigger Condition。
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "runes",
          filter: { type: "rune", controller: "self", zone: "rune-zone" }
        },
        operator: "gte",
        right: { kind: "constant", value: 7 }
      }
    },
    optional: false,
    body: [
      {
        // "If it's [Empowered]"：结算开始时读一次选定装备的状态并冻结成链接值
        // （契约 3.9 的 condition.value），之后的 Disempower 不会改写该判定。
        id: "tomb-raider-barbara.read-empowered",
        op: "condition.value",
        args: {
          value: {
            kind: "object-property",
            object: { target: "tomb-raider-barbara.enemy-gear" },
            property: "empowered"
          },
          key: { kind: "constant", value: "empowered" }
        },
        targets: [
          {
            id: "tomb-raider-barbara.enemy-gear",
            // 355.9.a.1："gear" 默认指 Board 上的对象；170.x 的 enemy = 对手控制。
            filter: { type: "gear", zone: "board", controller: "opponent" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      },
      {
        id: "tomb-raider-barbara.disempower-empowered-gear",
        op: "effect.empower",
        // 依赖于冻结读数：读数被忽略时本分支同样被忽略（359.3.e.14.a）。
        linkedTo: "tomb-raider-barbara.read-empowered",
        args: {
          // 443.1：移除该对象的一个 Empowered 状态（443.1.b）。
          mode: { kind: "constant", value: "disempower" },
          objects: { kind: "constant", value: { kind: "target", id: "tomb-raider-barbara.enemy-gear" } }
        },
        // "If it's [Empowered], disempower it."：以冻结读数为判别器（442.1.a/442.2）。
        condition: {
          kind: "compare",
          left: {
            kind: "linked-value",
            instructionId: "tomb-raider-barbara.read-empowered",
            key: "empowered"
          },
          operator: "gte",
          right: { kind: "constant", value: 1 }
        },
        // 同一次最终选择：两条分支绑定同一 TargetSpec（355.5/355.8/355.15）。
        targets: [
          {
            id: "tomb-raider-barbara.enemy-gear",
            filter: { type: "gear", zone: "board", controller: "opponent" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      },
      {
        id: "tomb-raider-barbara.kill-otherwise",
        op: "effect.kill",
        linkedTo: "tomb-raider-barbara.read-empowered",
        args: { target: { kind: "constant", value: "tomb-raider-barbara.enemy-gear" } },
        // "Otherwise, kill it."——同一冻结读数的否定分支，两条互斥（359/429）。
        condition: {
          kind: "not",
          condition: {
            kind: "compare",
            left: {
              kind: "linked-value",
              instructionId: "tomb-raider-barbara.read-empowered",
              key: "empowered"
            },
            operator: "gte",
            right: { kind: "constant", value: 1 }
          }
        },
        targets: [
          {
            id: "tomb-raider-barbara.enemy-gear",
            filter: { type: "gear", zone: "board", controller: "opponent" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-6ccd172775e91456e983a8fb755f02c8109a6e6dca539bb690585245e7e22176",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "唯一缺口，均不近似实现：(1) 442.1.a / 442.2 的 Empowered 状态由参考内核/动作层计数" +
    "（test-kernel 的 MutableObject.empowered；empower 自增、disempower 清零），但 effects/contract.ts 的 " +
    "ObjectSnapshot 没有 empowered 字段（只有 buffs），apps/game-server 的 empower 动作把它记在 buffs 上，" +
    "生产快照因此拿不到该读数。本任务实测：参考内核里 object-property target.empowered 能正确求值并驱动两条" +
    "互斥分支；按契约字段裁剪快照后同一条件抛 MissingInformation(\"Unavailable characteristic: empowered\")。" +
    "卡内已改用 condition.value 冻结读数 + linked-value 比较（可审查、可执行、缺读数时 fail closed）。" +
    "依赖：ObjectSnapshot 声明 Empowered 状态特征（契约变更请求）。" +
    "符号 7 是 383.2.a.1 的触发条件（符文区 rune 计数 >= 7，133.5.a.1 / 431.1）；" +
    "effect.empower（mode: disempower，443.1.b）与 effect.kill（429.1/429.2.a）本体已合入，golden 用锁定目标真实执行。",
  abilities,
  sourceText:
    "When you play me, if you control 7 or more runes, choose an enemy gear. If it's [Empowered], disempower it. Otherwise, kill it."
} satisfies CardProgram;
