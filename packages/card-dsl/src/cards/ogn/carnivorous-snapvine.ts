import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Carnivorous Snapvine (ogn-149-298) — Unit（能量 5，力量 2，Might 6，Body；Shadow Isles）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogn-149-298，逐字）：
 *   "When you play me, choose an enemy unit at a battlefield. We deal damage
 *    equal to our Mights to each other."
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a / 383.4.a.1："When you play me…" 是 Play Effect（时点 card-played，
 *   359/407），在与本卡 FINAL 后进入链。
 * - 355.5 / 355.7 / 355.9.a.1 / 355.10："choose an enemy unit at a battlefield"
 *   在 Finalize 时选择一个具体 Game Object，是目标（用一个 TargetSpec 表达），
 *   合法性在 Finalize 锁定、Resolve 重验（359.3.e）。
 * - 418.6.b.3 例 Challenge（"They deal damage equal to their Mights to each
 *   other."）：伤害来源是**被选中的单位**而不是法术/能力本身（"The damage that
 *   Challenge causes to be dealt is dealt by the chosen units"），418.6.b.4 由该
 *   单位的控制者负责；两名单位各自造成等于自身 Might 的伤害。本卡与 Challenge 的
 *   文本同型，沿用其已合入且可执行的写法：`property: "ref"` 读取已声明的
 *   ObjectSnapshot.ref 字段（契约 3.6），`property: "might"` 在结算时读取当时值。
 * - 303.2：Game Action 从不真正同时发生；370.1.a.2 的对比例子正是"两条 kill 指令"。
 *   两条 Deal 指令各自结算，双方在任何 Cleanup 之前都已受到伤害，指令顺序不改变
 *   结果（与 ogn/challenge.ts 的既有可执行实现一致）。两条指令互不 linkedTo
 *   （359.3.e.14：只有直接引用前序动作结果时才链接）。
 * - 359.3.e.7 / e.13：被选单位在结算前离场时，读取它的指令被 ignored，而不是回退到
 *   最后已知信息。
 *
 * status: executable —— 效果本体（effect.damage + 运行时引用读取 + Might 读取）
 * 全部由已合入原语执行；golden 用生产链适配器（resolveChainBody）真实提交两条
 * damage，断言两条动作的 source 引用、双方实际伤害值与目标失效边界。触发到链的
 * CardProgram 绑定属引擎级接线（RIFT-257），不是本卡语义缺口。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        // "We deal ... to each other" 的第一段：本卡以自身 Might 对被选单位造成伤害
        // （418.6.b.3：伤害由被选中的单位造成）。
        id: "snapvine-deals",
        op: "effect.damage",
        args: {
          amount: {
            kind: "object-property",
            object: "self",
            property: "might"
          },
          source: {
            kind: "object-property",
            object: "self",
            property: "ref"
          },
          target: { kind: "constant", value: "snapvine.enemy-unit" }
        },
        targets: [
          {
            id: "snapvine.enemy-unit",
            // "an enemy unit at a battlefield"：355.9.b 的目标限制。"at a
            // battlefield" 是地点限制，用已合入图层匹配器（layers/filter.ts）的
            // location-type 词表拼写，由生产查询路径在 Finalize 与 Resolve 复验
            // （与已可执行的 ogn/blast-of-power 同写法）。
            filter: { type: "unit", controller: "opponent", location: "battlefield" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      },
      {
        // 第二段：被选单位以自身 Might 对本卡造成伤害；amount/source 都从同一
        // 目标选择符读取，引用失效时按 359.3.e.7 忽略本条。
        id: "enemy-deals",
        op: "effect.damage",
        args: {
          amount: {
            kind: "object-property",
            object: { target: "snapvine.enemy-unit" },
            property: "might"
          },
          source: {
            kind: "object-property",
            object: { target: "snapvine.enemy-unit" },
            property: "ref"
          },
          target: { kind: "constant", value: "snapvine.self" }
        },
        targets: [
          {
            id: "snapvine.self",
            // "me" 是宿主自身，由特征程序化选中、从不做选择（355.10.d.1）；契约
            // 3.6 的 "self" 锚点由解释器在运行时绑定宿主（同 sfd/sea-monkey）。
            filter: { object: "self", type: "unit", zone: "board" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-0198949b45425f8cf47078623d6647cf083dc1971553ed77552f307b6ca7031a",
  rulesetVersion: "core-1.5" as const,
  status: "executable" as const,
  abilities,
  sourceText:
    "When you play me, choose an enemy unit at a battlefield. We deal damage equal to our Mights to each other."
} satisfies CardProgram;

export default program;
