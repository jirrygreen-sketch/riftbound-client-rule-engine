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
 * - 动态关键词授予的指令入口（effects/instructions/continuous.grant-keyword.ts，
 *   op: continuous.grant-keyword）与 layers/ 的 ability 层消费已合入，但把卡程序的
 *   static 能力注册进图层的接线（programs/statics.ts 的 engine static binder）不支持
 *   controller:opponent / sameLocationAs:self 的来源相对 filter（staticFilter 对
 *   opponent 与非 self 锚点显式抛 judge-required），且 layers 的 conditionMatches
 *   对未知条件 kind 返回 true，designation 条件会被过度应用。
 * - 授予数值需要「此处敌方单位数」的计数位置：ObjectFilter 有 sameLocationAs 锚点，
 *   能表达「与本卡同在一个战场」，但把该计数作为另一个单位的 Assault 值需要一个表达式位置
 *   读它；且 Assault 的图层按 807.1.d 只在获得 Attacker 身份期间生效，而图层
 *   conditionMatches 目前把未知的 designation 条件 fallthrough 为 true，无法表达
 *   「仅攻击者身份期间生效」。
 * - [Accelerate] 的展开（effects/keywords/Accelerate.ts）与费用计划
 *   （src/cost/kinds/additional.ts 的 accelerate 组件）已合入，但把该费用接进
 *   链上打出 Finalize 的 optionalAdditional 收取与 805.6 付费后入场就绪替代的
 *   条件管线仍无消费方。
 * 依赖：static→图层接线的相对 filter 支持、layers designation 条件求值、
 * Finalize 的 Accelerate optionalAdditional 收取与入场就绪替代接线。
 * 不近似实现（不把动态数值写成固定 Assault、不把手写展开塞进卡程序）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "accelerate" },
  {
    kind: "static",
    effect: {
      // 契约 3.7 模板中的 continuous.grant-keyword：把 Assault 授予本卡，
      // 数值为「此处敌方单位数」。op 与 layers ability 层已合入；卡程序接线
      // 无法解析这里的相对 filter（见 judgeReason）。
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
    "「I have [Assault] equal to the number of enemy units here」的动态关键词授予有三处当前真实缺口：" +
    "(1) continuous.grant-keyword 指令原语与 layers ability 层已合入，但把卡程序 static 能力注册进" +
    "图层的 statics 接线不支持 controller:'opponent' / sameLocationAs:'self' 的来源相对 filter" +
    "（statics.ts staticFilter 对 opponent 与非 self 锚点抛 judge-required）；" +
    "(2) layers conditionMatches 对未知条件 kind 返回 true，807.1.d 的「只在攻击者身份期间生效」" +
    "designation 条件会被无条件过度应用；" +
    "(3) [Accelerate]（805）的关键词展开与 accelerate 费用计划已合入，但接进打出流程" +
    "Finalize 的 optionalAdditional 收取与 805.6 入场就绪替代条件的管线仍无消费方。" +
    "数值本身是动态计数（此处敌方单位数），不能用静态的 { keyword: \"assault\", value: N } 冒充。" +
    "依赖：static→图层接线的相对 filter 支持、layers designation 条件求值、" +
    "Finalize Accelerate 接线。不近似实现（动态数值不写成固定 Assault、" +
    "不把关键词展开手写进卡程序）。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_chaos: as an additional cost to have me enter ready.)\n" +
    "I have [Assault] equal to the number of enemy units here. (+1 :rb_might: while I'm an attacker for each instance of Assault.)"
} satisfies CardProgram;

export default program;
