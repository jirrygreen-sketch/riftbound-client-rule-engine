import type { CardProgram } from "../../ir/index.js";

/**
 * Fallen Feline (ven-132-166) — Unit, 2 Energy + 1 Order Power, 3 Might,
 * Order, Cat/Piltover.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-132-166，逐字）：
 *   When you play me, name a spell.
 *   While I'm at a battlefield, opponents can't play spells with that name.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a：“When you play me” 是打出触发，时点 card-played，过滤自身。
 * - 759–762：命名须识别唯一牌名；762 要求赛制合法，762.1 禁止不存在的牌，762.2
 *   禁止 token 名称。结果需要跨触发链项持久绑定到宿主，供静态限制读取。
 * - “While I'm at a battlefield” 仅在宿主位于 battlefield 时生效；Base 也有 location，
 *   不能用 location != null 近似。用宿主锚点、board 区域与 battlefield 类型计数表达门控。
 * - continuous.restrict 的 prohibit / play-spell 与 chain 的限制查询已经接通；剩余缺口
 *   是命名选择、命名结果的持久绑定，以及静态 binder 的 opponent 相对玩家过滤。
 * 程序中的 choice.name 与 namedFrom 保留为描述性依赖，不把未知命名结果近似成全名禁用。
 */
export default {
  canonicalCardId: "card.hash-e308123735feeaeba45468a3883162bc0278fffe1ef3374615c10a8647de047c",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺少 choice.name 命名选择及赛制合法非 token 名称校验（759–762/762.1/762.2）；" +
    "命名结果尚不能从触发链项持久绑定到宿主并由静态 continuous.restrict 的 namedFrom 读取。" +
    "programs/statics.ts 也尚不支持 appliesTo:opponent 的相对玩家限制过滤，layers/rules/query.ts 的 restrictions 查询未消费静态战场条件。",
  abilities: [
    {
      kind: "triggered",
      trigger: { at: "card-played", filter: { self: true } },
      optional: false,
      body: [
        {
          // “name a spell”：命名结果经链接值 `namedCard` 传给下面的静态限制。
          // 原语未合入（见 judgeReason）。
          id: "fallen-feline.name-a-spell",
          op: "choice.name",
          args: {
            kind: { kind: "constant", value: "spell" },
            linkKey: { kind: "constant", value: "namedCard" }
          }
        }
      ]
    },
    {
      // “While I'm at a battlefield”：宿主位置条件；“opponents can't play
      // spells with that name”：禁止项读取宿主命名结果（连续限制，不进链）。
      kind: "static",
      effect: {
        kind: "continuous.restrict",
        // 合并原语与链路已支持 prohibit + action "play-spell"。
        mode: "prohibit",
        actions: ["play-spell"],
        appliesTo: "opponent",
        filter: { type: "spell" },
        // 被禁止的牌名来自上面命名指令写入的链接值：`namedFrom` 是描述性依赖
        // 记录（命名结果的持久绑定与 namedFrom 消费尚缺，不写成假的可执行表达式）。
        namedFrom: { instructionId: "fallen-feline.name-a-spell", key: "namedCard" }
      },
      condition: {
        kind: "compare",
        left: {
          kind: "count",
          subject: "host-at-battlefield",
          filter: { object: "self", zone: "board", location: "battlefield" }
        },
        operator: "gte",
        right: { kind: "constant", value: 1 }
      }
    }
  ],
  sourceText:
    "When you play me, name a spell.\n" +
    "While I'm at a battlefield, opponents can't play spells with that name."
} satisfies CardProgram;
