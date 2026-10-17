import type { CardProgram } from "../../ir/index.js";

/**
 * Lecturing Yordle (ogn-087-298) — Unit, 3 energy, 2 Might, Mind,
 * Yordle / Bandle City.
 *
 * Printed text:
 *   [Tank] (I must be assigned combat damage first.)
 *   When you play me, draw 1.
 *
 * Status: judge-required (复核 2026-10-17，第三轮 M2 覆盖率复核).
 * - Tank (815) 仍是真实缺口：KeywordDef 已合入（RIFT-264，effects/keywords/Tank.ts
 *   展开为 static continuous.combat 的致命伤害分配要求），但 `continuous.combat` 没有
 *   combat 消费方——combat/base-combat-allocation.ts 明确写「No Tank/Backline/other
 *   assignment-priority requirement is bound here」，layers/ 只为该 kind 提供注册/持久化
 *   （layers/ops/index.ts、layers/engine.ts 的 applyAbility 不读 combat kind），
 *   815.1.b / 815.1.c.2 的「先被分配致命伤害」不可执行。不近似实现。
 * - 「When you play me, draw 1」**已不再缺依赖**：card-played 订阅经由已合入的
 *   RIFT-257 程序绑定（programs/triggers.ts 的 activeZones 对永久物用 board）注册，
 *   双层 golden 用真实 ChainEngine + describePlay 打出本卡，断言 card-played 时点触发、
 *   本卡进入 Board、effect.draw（414.1/414.3）真实抽到 1 张。旧 judgeReason 记的
 *   「触发注册依赖 RIFT-257」已过时。
 */
export default {
  canonicalCardId: "card.hash-d5bee8c48f53404d08ff88d8472305114b39bc2f137cfb3e59c46e99340d0119",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "[Tank]（815）的 KeywordDef 已合入（RIFT-264，effects/keywords/Tank.ts 展开为 static continuous.combat 的致命分配要求），" +
    "但 continuous.combat 仍没有 combat 消费方：combat/base-combat-allocation.ts 明确不绑定 assignment-priority，" +
    "layers/ops/index.ts 也只为该 kind 提供注册/持久化，815.1.b / 815.1.c.2 的「先被分配致命伤害」不可执行。" +
    "「When you play me, draw 1」已可执行：card-played 订阅由已合入的 RIFT-257 程序绑定注册（programs/triggers.ts），" +
    "golden 用真实 ChainEngine 打出本卡并断言触发与 effect.draw（414.1/414.3）真实抽牌。" +
    "当前唯一缺口是 combat 分配消费方（continuous.combat）。不近似实现。",
  abilities: [
    { kind: "keyword", keyword: "tank" },
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: { event: "card-played", filter: { role: "self" } }
      },
      optional: false,
      body: [
        {
          id: "lecturing-yordle.draw-1",
          op: "effect.draw",
          args: { amount: { kind: "constant", value: 1 } }
        }
      ]
    }
  ],
  sourceText: "[Tank] (I must be assigned combat damage first.)\nWhen you play me, draw 1."
} satisfies CardProgram;
