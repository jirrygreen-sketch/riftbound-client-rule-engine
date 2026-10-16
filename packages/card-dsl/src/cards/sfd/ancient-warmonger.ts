import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Ancient Warmonger (sfd-131-221) — Unit, Chaos, tags Spirit/Noxus.
 * energy 5, power: none printed, Might 4.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-131-221，逐字，含换行）:
 *   "[Accelerate] (You may pay :rb_energy_1::rb_rune_chaos: as an additional cost to have me enter ready.)\n"
 *   "I have [Assault] equal to the number of enemy units here. (+1 :rb_might: while I'm an attacker for each instance of Assault.)"
 *
 * 规则依据（CR v1.5）：
 * - [Accelerate]（805）：可选附加费用关键词，805.1.b 规定费用固定为 1 energy + 1 power
 *   （本卡为 Chaos 域的 [C]，805.1.b.1 要求 Power 与单位某一域匹配）；805.4 规定多份
 *   Accelerate 冗余（stacking "single"）；805.6/805.6.a 是付费后的入场就绪替代。卡内只声明
 *   { kind: "keyword", keyword: "accelerate" }（契约 3.7/README 第 5 节），展开由已合入的
 *   effects/keywords/Accelerate.ts 负责。
 * - "I have [Assault] equal to the number of enemy units here"：这是把 Assault 授予自身、
 *   数值等于「此处敌方单位数」的动态关键词授予；807.1.b.2 规定 Assault Value 可被功能文本
 *   引用，807.3 说明「是否拥有 Assault」是可读取特征。
 * - reminder 括号（“+1 :rb_might: while I'm an attacker for each instance of Assault.”）是
 *   807.1.c 的释义（Assault 在攻击时按每份 +1 Might），不是独立指令。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。三处已合入缺口：
 * - 动态关键词授予没有可执行路径：effects/instructions/ 下没有任何原语注册
 *   continuous.grant-keyword（没有任何已合入指令调用 ResolveContext.addContinuous），
 *   layers/ 也没有把卡程序的 static 能力注册进图层的消费方（契约 3.7/RIFT-91）；
 *   本卡不能只声明一个静态的 assault keyword 冒充，因为数值是动态的。
 * - 授予数值需要「此处敌方单位数」的计数位置：ObjectFilter 有 sameLocationAs 锚点，
 *   能表达「与本卡同在一个战场」，但把该计数作为另一个单位的 Assault 值需要一个表达式位置
 *   读它；且 Assault 的图层按 807.1.d 只在获得 Attacker 身份期间生效，而 ObjectSnapshot
 *   没有 combatRole/designation（契约 3.8 只冻结字段设计），RIFT-91/战斗批次未实现。
 * - [Accelerate] 的展开（effects/keywords/Accelerate.ts）已合入，但其费用计划消费方
 *   （Finalize 的 optionalAdditional 接线）与 805.6 的入场就绪替代管线仍属 RIFT-89/91。
 * 依赖：RIFT-91（layers-continuous 的 continuous.grant-keyword 与 designation）、
 * RIFT-81（kw-assault-shield 的展开）、RIFT-89（费用计划）。
 * 不近似实现（不把动态数值写成固定 Assault、不把手写展开塞进卡程序）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "accelerate" },
  {
    kind: "static",
    effect: {
      // 契约 3.7 / RIFT-9 模板中的 continuous.grant-keyword：把 Assault 授予本卡，
      // 数值为「此处敌方单位数」。该 kind 尚无已注册原语/图层消费者（见 judgeReason）。
      kind: "continuous.grant-keyword",
      appliesTo: "self",
      keyword: "assault",
      // 806/807.1.b.2：授予值是动态计数——「敌方单位在此战场的数量」。
      // sameLocationAs 锚点指称本卡所在地点（449/421.1 的 Location）。
      value: {
        kind: "count",
        subject: "units",
        filter: {
          type: "unit",
          controller: "opponent",
          zone: "board",
          sameLocationAs: "self"
        }
      }
    }
  }
];

const program = {
  canonicalCardId: "card.hash-3657fb1a42b929920135ba38e292bf53fa1112a145cf12bb352cd750e3b64e60",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「I have [Assault] equal to the number of enemy units here」的动态关键词授予没有可执行路径：" +
    "effects/instructions/ 下没有任何原语注册 continuous.grant-keyword，也没有任何已合入指令调用 " +
    "ResolveContext.addContinuous（addContinuous 只有说明，无写入方），layers/ 同样没有把卡程序 static " +
    "能力注册进图层的消费方（RIFT-91）；数值本身又是动态计数（此处敌方单位数），不能用静态的 " +
    "{ keyword: \"assault\", value: N } 冒充。此外 807.1.d 规定 Assault 只在获得 Attacker 身份期间生效，" +
    "而 ObjectSnapshot 没有 combatRole/designation（契约 3.8 只冻结字段设计，实现属 RIFT-91/战斗批次），" +
    "图层无法判定攻击者状态。[Accelerate]（805）的展开 effects/keywords/Accelerate.ts 已合入" +
    "（accelerate.cost + 805.6 的入场就绪替代），但其费用计划消费方（Finalize 的 optionalAdditional 接线）" +
    "属 RIFT-89 批次。依赖：RIFT-91（layers-continuous 的 continuous.grant-keyword 与 designation）、" +
    "RIFT-81（kw-assault-shield 展开）、RIFT-89（费用计划）。不近似实现（动态数值不写成固定 Assault、" +
    "不把关键词展开手写进卡程序）。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_chaos: as an additional cost to have me enter ready.)\n" +
    "I have [Assault] equal to the number of enemy units here. (+1 :rb_might: while I'm an attacker for each instance of Assault.)"
} satisfies CardProgram;

export default program;
