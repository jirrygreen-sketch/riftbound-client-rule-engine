import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Stalwart Goatherd (rad-083-167) — Unit, 4 energy, Might 2, Body。
 *
 * 原文（packages/card-data/data/deck-catalog.json，sourceText 逐字）：
 *   [Shield 2] (+2 :rb_might: while I'm a defender.)
 *   When you play me, you may kill a gear with Energy cost :rb_energy_4: or less.
 *
 * 规则依据（CR v1.5）：
 * - [Shield 2] 是带数值的被动关键词（814.1.b/.c），以带 value 的 keyword 能力声明；
 *   展开（defender 指定 + continuous.might）由 effects/keywords/Shield.ts 负责。
 * - "you may kill a gear with Energy cost 4 or less"：383.3.a 的 "you may" 由玩家在
 *   Finalize 决定是否执行 → 契约 3.9 要求用 choice.optional 把被选指令包进 body，
 *   而不是 choice + linkedTo。"a gear" 是 355.5 的单数选择，effect.kill 需要一个已
 *   锁定对象，故写成 TargetSpec（min=max=1）；"Energy cost 4 or less" 是 355.9.b 的
 *   选择限制条件，用 filter 的 energyLte 记录（目标管线按印刷 Energy cost 求值）。
 * - kill 是 429 的消灭动作，已合入 effect.kill 原语（429.1.a.1 的 Kill Instruction）。
 *   "Energy cost 4 or less" 的判定依赖目标管线对 ObjectSnapshot.energy（印刷 Energy
 *   费用，null = 无印刷值，CR 163.1/356.x）的支持；当前 filter 键 energyLte 没有已合入
 *   的消费者，故选卡保持 judge-required，不把该条件近似成无条件消灭 gear。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "shield", value: 2 },
  {
    kind: "triggered",
    trigger: { at: "card-played", filter: { self: true } },
    optional: false,
    body: [
      {
        // 383.3.a："you may" 由玩家在 Finalize 决定；契约 3.9 要求 choice.optional
        // 把被选指令包进 body（拒绝 → 本条 negated/skipped，后续指令照常）。
        id: "stalwart-goatherd.may",
        op: "choice.optional",
        args: {
          prompt: { kind: "constant", value: "Kill a gear with Energy cost 4 or less?" },
          body: {
            kind: "constant",
            value: [
              {
                id: "stalwart-goatherd.kill",
                op: "effect.kill",
                args: {
                  target: { kind: "constant", value: "stalwart-goatherd.gear" },
                  reason: { kind: "constant", value: "stalwart-goatherd" }
                },
                targets: [
                  {
                    id: "stalwart-goatherd.gear",
                    filter: { type: "gear", zone: "board", energyLte: 4 },
                    min: 1,
                    max: 1,
                    selection: "one"
                  }
                ]
              }
            ]
          }
        }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-7f7a5adb7ade7c414e4fe27dffeabdf651e620759800bc7ab9794451ca9952a9",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「a gear with Energy cost :rb_energy_4: or less」的选择条件没有已合入的消费者：契约的 ObjectFilter 只有" +
    "静态值（没有 energyLte 求值语义），ObjectSnapshot.energy 是印刷 Energy 费用（null = 无印刷值，" +
    "CR 163.1/356.x 不得当 0），目标管线（RIFT-90 target-plan）未按该键筛选，故不能安全地挑出" +
    "「Energy cost 4 或以下」的 gear，不用无条件消灭 gear 近似。kill 原语（effect.kill）与 383.3.a 的" +
    "可选结构（choice.optional，契约 3.9）已合入；[Shield 2] 的展开由 RIFT-81 的关键词文件负责。" +
    "依赖：RIFT-90（目标限制求值）、RIFT-81（Shield 展开）。",
  abilities,
  sourceText:
    "[Shield 2] (+2 :rb_might: while I'm a defender.)\n" +
    "When you play me, you may kill a gear with Energy cost :rb_energy_4: or less."
} satisfies CardProgram;

export default program;
