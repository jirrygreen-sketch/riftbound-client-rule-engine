import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Rek'Sai, Breacher (sfd-029-221) — Unit, Fury, Rek'Sai/The Void/Champion.
 * energy 3, power: none printed, Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-029-221，逐字，含换行）:
 *   "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n"
 *   "[Assault] (+1 :rb_might: while I'm an attacker.)\n"
 *   "Friendly units played from anywhere other than a player's hand have [Accelerate]."
 *
 * 规则依据（CR v1.5）:
 * - [Accelerate]（805.1.b）：可选附加费用关键词，费用固定 1 energy + 1 power（805.1.b.1
 *   要求 Power 与单位某一域匹配）；卡内只声明 keyword，展开（accelerate.cost 声明 +
 *   805.6/805.6.a 的入场就绪延迟替代）由 effects/keywords/Accelerate.ts 负责。
 * - [Assault]（807.1.b.3）：未印刷数值视为 1；卡内只声明 keyword。Assault 展开为
 *   arithmetic 层 + designation 条件（effects/keywords/Assault.ts）。
 * - "Friendly units played from anywhere other than a player's hand have [Accelerate]."：
 *   持续授予（364.1/364.2 的被动能力），由已合入的 continuous.grant-keyword 原语
 *   （RIFT-258）执行——它经 ResolveContext.addContinuous 在 ability 层登记授予，
 *   由 layers/engine.ts 写进 keywords（golden 有真实执行证据）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required，三条依赖未合入，均不近似实现：
 * - 授予句的关键词行使权：continuous.grant-keyword 原语已合入，但没有已合入路径把卡牌的
 *   static 能力注册进图层——programs/lifecycle.ts 的 attachProgramLifecycle 只在调用方提供
 *   staticBinder 时回调 bindStatic，而仓库内没有任何生产调用方提供 staticBinder
 *   （apps/ 与 packages/ 都没有 createProgramBinding 的 staticBinder 使用），因此该 static
 *   能力在生产中不会登记。
 * - 「played from anywhere other than a player's hand」需要打出来源区域的谓词：ObjectFilter 只做
 *   类型/控制者/所有者/区域/状态/tags/characteristics 匹配（layers/filter.ts 的 matchesObjectFilter），
 *   不表达「从哪个区域打出」；golden 里 filter 的 playedFromZoneNot 只是描述性占位、无正式语义。
 * - [Accelerate] 的费用计划接线：805.6/805.6.a 的「付费后以就绪进场替代横置进场」需要打出流程在
 *   Finalize 选择并收取可选附加费用（cost.additional / cost.pay 的卡牌侧接线未合入），
 *   [Assault] 还需要 attacker designation 的图层条件求值（layers/engine.ts 的 conditionMatches
 *   不处理 designation 谓词，实测未知条件会落到 true，见 golden 的说明）。
 * 依赖：卡牌 static 能力的图层注册方（RIFT-257 后续）、打出来源区域谓词、可选附加费用接线与
 * designation 条件求值（RIFT-261 / RIFT-91 后续）。不近似实现（不把授予句写成冗余 keyword 声明，
 * 也不让 [Assault] 在没有 designation 求值时产生无条件的 +1 Might）。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "accelerate" },
  { kind: "keyword", keyword: "assault" },
  {
    kind: "static",
    effect: {
      kind: "continuous.grant-keyword",
      keyword: "accelerate",
      filter: {
        type: "unit",
        controller: "controller",
        zone: "board",
        // 描述性过滤键：现有 ObjectFilter 词汇没有「打出来源区域」谓词
        // （layers/filter.ts 的 matchesObjectFilter 不读该键，故它在引擎里不产生任何语义）。
        playedFromZoneNot: "hand"
      }
    }
  }
];

const program = {
  canonicalCardId: "card.hash-6eb6345b70c561ae3d2ed335eb50fdd0958d942af912aaceba44ad0038813815",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三条依赖未合入，均不近似实现。" +
    "(1) 授予句的关键词行使权：continuous.grant-keyword 原语已合入（RIFT-258，经 addContinuous 在 ability 层登记，golden 用解释器 + 图层引擎真实执行并断言目标单位获得 accelerate），" +
    "但没有已合入路径把卡牌的 static 能力注册进图层：programs/lifecycle.ts 的 attachProgramLifecycle 只在调用方传入 staticBinder 时回调 bindStatic，仓库内没有生产调用方提供它。" +
    "(2)「played from anywhere other than a player's hand」需要打出来源区域的谓词：ObjectFilter 只做类型/控制者/所有者/区域/状态/tags/characteristics 匹配" +
    "（layers/filter.ts 的 matchesObjectFilter 明确不读 playedFromZoneNot），golden 里的该键只是描述性占位、无正式语义。" +
    "(3) [Accelerate] 的费用接线：805.6/805.6.a 的「付费后以就绪进场替代横置进场」需要打出流程在 Finalize 选择并收取可选附加费用（cost.additional/cost.pay 的卡牌侧接线未合入）；" +
    "[Assault] 展开的 arithmetic 效果带 designation 条件，layers/engine.ts 的 conditionMatches 不处理 compare(designation)，未知条件会落到 true，因此无可执行的 attacker 判定。" +
    "依赖：卡牌 static 能力的图层注册方（RIFT-257 后续）、打出来源区域谓词、可选附加费用接线（RIFT-261）与 designation 条件求值（RIFT-91 后续）。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
    "[Assault] (+1 :rb_might: while I'm an attacker.)\n" +
    "Friendly units played from anywhere other than a player's hand have [Accelerate]."
} satisfies CardProgram;

export default program;

