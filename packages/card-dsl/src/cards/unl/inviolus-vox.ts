import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Inviolus Vox (unl-027-219) — Unit, 8 energy, 2 power, Might 8, Fury,
 * tags Dragon/Mount Targon.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-027-219，逐字）：
 *   When I conquer, give a friendly unit +8 :rb_might: this turn.
 *
 * 规则依据（CR v1.5）：
 * - 383.4.c / 383.4.c.1 / 383.4.c.2.a：“When I conquer …” 是 Conquer Effect——
 *   Condition 含“本单位参与并成功征服一个战场”的触发式能力，在单位仍在该战场且玩家因征服得分后
 *   作为 Pending Item 进链；封闭时点表里的 conquer（scoring 发出，ruleRefs 468.5.d / 471.1 / 473.2.a）
 *   就是它。383.4.c.2.c：即使得分被替代/否定，本触发仍进链，因此不把得分成功作为条件。
 * - 355.9 / 355.10：“give a friendly unit …” 让玩家选择一个由你控制的单位，是选目标（targets），
 *   不是 pick（355.7）；355.9.a.1 规定未特别说明的 “unit” 指棋盘上的单位。
 * - “+8 :rb_might: this turn”：对本回合有效的临时 Might 修正（143.2.a 的 Might 指有效 Might；
 *   475/478 的算术层与期限），属 layers 的 continuous.might；effect.buff 的文件头明确 Buff 计数器
 *   （702/703）不是 Might 修正，两者不可互换。
 *
 * status = judge-required（缺口不近似实现）：
 * - effects/instructions/ 与关键词注册表都没有注册 continuous.might（或等价临时 Might 修改）原语：
 *   契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，也没有任何指令通过 ResolveContext.addContinuous
 *   注册该持续效果（RIFT-91 只合入了 layers 的求值侧），因此 golden 实测 runAbilityBody 对该 op 抛
 *   “Unregistered instruction opcode”。
 * - 触发本身没有 CardProgram → TriggerRegistration 的注册路径（RIFT-120）。
 * 结构（时点、filter、目标形状、数额与期限）保留并做结构校验，不把 +8 Might 近似成 8 个 Buff 计数。
 * 依赖：RIFT-91（layers-continuous 的卡牌指令入口）、RIFT-120（触发注册）。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "conquer",
      // 383.4.c.2：“When I conquer” 的 Conquer Effect 由本卡自身的征服触发。
      filter: { event: "conquer", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        id: "inviolus-vox.grant-might-8",
        // “give a friendly unit +8 :rb_might: this turn.” —— 本回合到期的临时 Might 修正
        // （arithmetic 层，见 judgeReason）；没有已注册的原语消费该形状。
        op: "continuous.might",
        args: {
          mode: { kind: "constant", value: "add" },
          layer: { kind: "constant", value: "arithmetic" },
          amount: { kind: "constant", value: 8 },
          duration: { kind: "constant", value: "this-turn" }
        },
        targets: [
          {
            id: "inviolus-vox.friendly-unit",
            // 355.9 / 355.9.a.1：“a friendly unit” 是由你控制的单个棋盘单位。
            filter: { type: "unit", controller: "controller", zone: "board" },
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
  canonicalCardId:
    "card.hash-f11b51df9013e0151586a2443eb2342dba8ad5f6aa01ea4e5f5bb83f35e722df",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「give a friendly unit +8 :rb_might: this turn.」是需要 arithmetic 层本回合到期的临时 Might 修正（143.2.a/475/478），" +
    "但没有可执行路径：契约 3.6 的封闭 GameAction 集合没有 Might 修改动作，effects/instructions/ 与关键词注册表都没有 " +
    "continuous.might（或等价临时 Might 修改）原语，也没有任何指令通过 ResolveContext.addContinuous 注册该持续效果" +
    "（RIFT-91 只合入 layers 求值侧），golden 实测 runAbilityBody 对该 op 抛 Unregistered instruction opcode。" +
    "effect.buff 只放 Buff 计数器（702/703），不是 Might 修正，不得代替。" +
    "此外 conquer 触发没有 CardProgram → TriggerRegistration 的注册路径（RIFT-120）。" +
    "依赖：RIFT-91（layers-continuous 的指令入口）、RIFT-120（触发注册）。不近似实现，不用 8 个 Buff 顶替 +8 Might。",
  abilities,
  sourceText: "When I conquer, give a friendly unit +8 :rb_might: this turn."
} satisfies CardProgram;

export default program;
