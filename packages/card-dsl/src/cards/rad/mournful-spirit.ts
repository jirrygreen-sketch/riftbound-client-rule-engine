import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Mournful Spirit (rad-126-167) — Unit, Order, 4 energy / 无印刷力量 / 1 Might，标签 Spirit。
 *
 * sourceText (packages/card-data/data/deck-catalog.json, rad-126-167):
 *   "[Deathknell][>] You may kill a unit or gear here. (When I die, get the effect.)"
 *
 * 规则依据（CR v1.5）：
 * - [Deathknell]（808）：触发能力关键词，808.1.c 等于 "When I die, [Effect]"；
 *   808.1.d 说起源（死亡）的触发，在替代处理后、离开区域前收集；808.1.d.2 于换区前
 *   进入链；808.1.d.3 记录当时位置与特征；808.2 多个 Deathknell 各自触发。
 *   按契约 3.1 声明 keyword 能力，展开由 effects/keywords/Deathknell.ts 负责
 *   （已存在：订阅 object-killed 的触发骨架）。
 * - "You may kill a unit or gear here." 的 "you may" 位于效果第一段 → 383.3.a
 *   由触发能力控制者在 Finalize 决定是否执行该触发能力（383.3.a.1/.a.2），
 *   因此用 triggered.optional = true，而不是 body 里的 choice.optional。
 * - "a unit or gear here"：429.6 的 Kill 指令是目标；"here" 指死亡前记录的位置
 *   （808.1.d.3），用 sameLocationAs: "self" 描述"与来源同位置"。
 *
 * 无法执行的依赖（保持 judge-required）：
 * - effect.kill、object-killed 时点与解释器均已合入（黄金测试实际执行 kill 与
 *   optional 分支），但 CardProgram 的触发能力→事件管线注册（把 keyword 展开与
 *   triggered 能力接到 events/pipeline 的 object-killed 上）尚未接线；
 *   Deathknell 的替代死亡处理（808.1.d.1）与 last-known 位置记录（808.1.d.3）
 *   属触发/事件批次的缺口。
 * - "here" 的 sameLocationAs: "self" 在来源已离场后必须靠 808.1.d.3 的最后已知
 *   位置求值；参考内核只在显式提供 host 绑定时解析该锚点，生产链尚未实现。
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
            filter: { type: ["unit", "gear"], zone: "board", sameLocationAs: "self" },
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
    "缺卡牌触发能力→事件管线的接线与 Deathknell 的触发细节：808.1.d.1（死亡被替代" +
    "时触发移出链）、808.1.d.2（换区前作为 Pending Item 入链）、808.1.d.3（记录最后已知" +
    "位置以解析 \"here\"）都需要 events/chain 侧的卡牌程序消费方，当前 CardProgram 的" +
    "triggered 能力不会被注册到 events/pipeline（依赖关键词/触发批次 RIFT-82 与" +
    "批 4 的卡牌接线）。effect.kill 原语、object-killed 时点与解释器已合入，黄金测试" +
    "用参考内核真实执行 kill 与 optional 分支，但不宣称整卡可执行。",
  abilities,
  sourceText:
    "[Deathknell][>] You may kill a unit or gear here. (When I die, get the effect.)"
} satisfies CardProgram;

export default program;
