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
 * - [Assault]（807.1.b.3）：未印刷数值视为 1；卡内只声明 keyword。
 * - "Friendly units played from anywhere other than a player's hand have [Accelerate]."：
 *   持续授予（364.1/364.2 的被动能力），需要 continuous.grant-keyword 把 Accelerate
 *   授给「不是从手牌打出」的友方单位。这不是关键词声明，而是静态授予效果。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。
 * - 授予句需要 continuous.grant-keyword 持续效果：effects/instructions/ 下没有该原语
 *   （RIFT-9 的 continuous.keyword 缺口），layers（RIFT-91）也没有把卡牌程序的 static
 *   能力注册进图层的消费方；且「played from anywhere other than a player's hand」需要
 *   打出来源区域（fromZone）的谓词，现有 ObjectFilter 只做类型/控制者/区域/状态/
 *   tags/characteristics 匹配，不表达「从哪个区域打出」。
 * - [Accelerate]/[Assault] 的关键词展开虽已合入（RIFT-81/86），但没有消费方把卡牌程序的
 *   keyword 能力展开并注册进图层，也没有 Attacker designation 读取（RIFT-91）。
 * 依赖：RIFT-9（continuous.keyword）、RIFT-91（layers-continuous）、打出来源区域谓词、
 * RIFT-89（Accelerate 的费用计划接线）。不近似实现（不把授予句写成冗余 keyword 声明）。
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
        // 描述性过滤键：现有 ObjectFilter 词汇没有「打出来源区域」谓词。
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
    "「Friendly units played from anywhere other than a player's hand have [Accelerate]」需要 continuous.grant-keyword 持续授予：" +
    "effects/instructions/ 没有该原语（RIFT-9 的 continuous.keyword 缺口），layers（RIFT-91）也没有把 CardProgram static 能力注册进图层的消费方；" +
    "并且「played from anywhere other than a player's hand」需要打出时来源区域的谓词（ObjectFilter 只做类型/控制者/区域/状态/tags/characteristics 匹配，" +
    "不表达「从哪个区域打出」），golden 里用 filter 的 playedFromZoneNot 只是描述性占位、无正式语义。" +
    "[Accelerate]（805）与 [Assault]（807.1.b.3）的展开文件（effects/keywords/Accelerate.ts、Assault.ts）虽已合入，" +
    "但没有消费方把卡牌程序的 keyword 能力展开并注册进图层，且 [Assault] 需要 Attacker designation（RIFT-91；ObjectSnapshot 无 combatRole/designation）；" +
    "[Accelerate] 的费用计划接线属 RIFT-89。依赖：RIFT-9、RIFT-91、RIFT-89、打出来源区域谓词。不近似实现。",
  abilities,
  sourceText:
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
    "[Assault] (+1 :rb_might: while I'm an attacker.)\n" +
    "Friendly units played from anywhere other than a player's hand have [Accelerate]."
} satisfies CardProgram;

export default program;
