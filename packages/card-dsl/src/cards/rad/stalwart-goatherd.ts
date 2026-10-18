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
 *   engine-core 里 energyLte 没有任何求值实现，而 programs/filters.ts 的
 *   translateObjectFilter 白名单也不含它——绑定 "kill gear with Energy cost 4 or
 *   less" 的目标约束会直接抛 judge-required，故选卡保持 judge-required，
 *   不把该条件近似成无条件消灭 gear。
 * - [Shield 2] 的 KeywordDef（effects/keywords/Shield.ts）已注册并经
 *   programs/keywords.ts / lifecycle / statics 接入生产绑定，展开为
 *   static continuous.might；但它的 defender 判别式写的是
 *   object-property(self, "designation") 比较 "defender"，而合并的 ObjectSnapshot
 *   只暴露 combatRole（无 designation 字段）。解释器表达式求值返回
 *   MissingInformation，bindStaticToLayers 的条件包装捕获异常后恒返回 false。
 *   实测：生产 binder 成功登记 continuous.might，但同一内核的
 *   engine.layers.evaluate() 仍给出印刷 Might 2（期望 4）；把判别式换成
 *   combatRole 的 condition.predicate 在同一快照上实测 true，说明唯一缺口是该
 *   判别式读的属性名（属 engine-core 的 keywords/Shield.ts，范围外）。
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
    "两项当前真实缺口（2026-10-18 实测）：" +
    "(1)「a gear with Energy cost :rb_energy_4: or less」的筛选没有求值器：engine-core 全部源码里 energyLte " +
    "没有任何求值实现（ObjectSnapshot.energy 是印刷值，null = 无印刷值，CR 163.1/356.x 不得当 0），" +
    "programs/filters.ts 的 translateObjectFilter 白名单也不含该键，绑定该目标约束实测抛 " +
    "judge-required “Unsupported filter field energyLte”（triggerRegistrations 同样在此失败），故不能安全地挑出该 gear，" +
    "不用无条件消灭 gear 近似。" +
    "(2) [Shield 2]（814.1）的 KeywordDef 已合入并经 programs/keywords.ts → lifecycle/statics 接入生产绑定，" +
    "但其展开条件的判别式写 object-property(self, \"designation\") == \"defender\"，合并的 ObjectSnapshot 只暴露 combatRole：" +
    "基础求值器返回 MissingInformation（实测 “Unavailable characteristic: designation”），bindStaticToLayers 的条件包装" +
    "捕获异常后恒返回 false——实测生产 binder 成功登记 continuous.might，但同一防守者快照上的 layers.evaluate() 仍为印刷 Might 2；" +
    "把判别式换成 combatRole 的 condition.predicate 则实测 true，说明缺口只是该属性名。" +
    "该判别式属 engine-core 的 keywords/Shield.ts（写域外）。" +
    "已可执行并由 golden 真实执行的部分：kill 原语（429，effect.kill）、383.3.a 的可选结构（choice.optional，契约 3.9）、" +
    "以及已锁定目标的 kill 与 decline 两条路径。",
  abilities,
  sourceText:
    "[Shield 2] (+2 :rb_might: while I'm a defender.)\n" +
    "When you play me, you may kill a gear with Energy cost :rb_energy_4: or less."
} satisfies CardProgram;

export default program;
