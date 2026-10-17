import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Mournful Spirit — CR v1.5 808.1.c/d, 383.3.a, 429.6.
 * The pipeline captures death-event last-known snapshots; the interpreter can
 * resolve "here" from the source after its zone reference becomes stale.
 * The production CardProgram adapter still rejects sameLocationAs and does
 * not attach this effect body to the Deathknell keyword's trigger.leave
 * skeleton. Those are specific boundaries, not missing generic trigger/LKI
 * machinery. Kill tests execute the original target declaration.
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "deathknell" },
  {
    kind: "triggered",
    trigger: { at: "object-killed", filter: { self: true } },
    // 383.3.a："you may" 是效果第一段 → Finalize 时决定是否执行该触发能力。
    optional: true,
    body: [
      {
        id: "mournful-spirit.kill-unit-or-gear",
        op: "effect.kill",
        args: { target: { kind: "constant", value: "mournful-spirit.unit-or-gear-here" } },
        targets: [
          {
            id: "mournful-spirit.unit-or-gear-here",
            filter: { type: ["unit", "gear"], zone: "board", sameLocationAs: "source" },
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
  canonicalCardId: "card.hash-32901e49217e3463bf29df57238a9370865527412373a7daa3ca361f82eb7a09",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "缺 Deathknell 正文与关键词骨架的绑定（CR 808.1.c/808.2）：keywords/Deathknell.ts 额外展开 trigger.leave 骨架，" +
    "programs/keywords.ts 将其与显式 triggered 能力并列，未把本卡 kill 正文挂入该实例；其 cause/destination 过滤元数据也没有专用消费路径。" +
    "另缺 programs/filters.ts 对 sameLocationAs: source 的生产目标翻译；解释器已能用来源最后已知位置解析 here（808.1.d.3），" +
    "events/pipeline.ts 也已有 object-killed 的死亡前快照，不能再列为通用触发或 LKI 缺失。",
  abilities,
  sourceText:
    "[Deathknell][>] You may kill a unit or gear here. (When I die, get the effect.)"
} satisfies CardProgram;

export default program;
