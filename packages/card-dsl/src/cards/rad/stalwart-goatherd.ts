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
 *   "Energy cost 4 or less" 的判定需要一个按印刷 Energy 费用筛选目标的求值器
 *   （ObjectSnapshot.energy 是印刷值，null = 无印刷值，CR 163.1/356.x）；
 *   ObjectFilter 没有该谓词，目标管线（target/target-plan.ts）只按 type/zone/location
 *   与调用方 isLegal 过滤，故选卡保持 judge-required，不把该条件近似成无条件消灭 gear。
 * - [Shield 2] 的 KeywordDef（RIFT-81 批的 keywords/Shield.ts）已注册，展开为
 *   static continuous.might，但它的 defender 判别式写的是
 *   object-property(self, "designation") 比较 "defender"，而合并的 ObjectSnapshot
 *   暴露的是 combatRole（无 designation 字段），且 layers/engine.ts 的
 *   conditionMatches 只认 kind: type/has-tag/has-keyword（未知 kind 一律返回 true）。
 *   把该展开原样注册进图层会让 +2 Might 对攻方与场外对象同样生效，故不据此宣称可执行。
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
    "两处缺口：(1)「a gear with Energy cost :rb_energy_4: or less」的目标筛选没有求值器：ObjectFilter 没有" +
    "印刷 Energy 费用的谓词（ObjectSnapshot.energy 是印刷值，null = 无印刷值，CR 163.1/356.x 不得当 0），" +
    "target/target-plan.ts 只按 type/zone/location 与调用方 isLegal 过滤，故不能安全地挑出该 gear，" +
    "不用无条件消灭 gear 近似。(2) [Shield 2] 的 KeywordDef 已合入（RIFT-81），但其展开的判别式写 " +
    "object-property(self, \"designation\") == \"defender\"，而合并的 ObjectSnapshot 只暴露 combatRole，" +
    "且 layers/engine.ts 的 conditionMatches 只识别 kind: type/has-tag/has-keyword（未知 kind 返回 true），" +
    "原样注册会让 +2 Might 对攻方与场外对象同样生效。" +
    "kill 原语（effect.kill）与 383.3.a 的可选结构（choice.optional，契约 3.9）已合入并由 golden 真实执行。" +
    "依赖：目标限制的印刷费用求值器、图层条件的 combatRole/designation 谓词（RIFT-91 范围）。",
  abilities,
  sourceText:
    "[Shield 2] (+2 :rb_might: while I'm a defender.)\n" +
    "When you play me, you may kill a gear with Energy cost :rb_energy_4: or less."
} satisfies CardProgram;

export default program;
