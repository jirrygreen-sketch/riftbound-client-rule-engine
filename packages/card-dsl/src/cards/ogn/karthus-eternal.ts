import type { CardProgram } from "../../ir/index.js";

/**
 * Karthus, Eternal (ogn-236-298) - Unit, Order, Spirit/Karthus/Shadow Isles/Champion (M2 unit
 * shard 12).
 *
 * sourceText (packages/card-data/data/deck-catalog.json, ogn-236-298):
 *   Your [Deathknell] effects trigger an additional time.
 *
 * 规则依据（CR v1.5）：
 * - 808.1 / 808.1.a / 808.1.c：Deathknell 是触发式能力关键词，功能上等同 "When I die,
 *   [Effect]."；展开由 keywords/Deathknell.ts 负责（808.1.d：该触发在换区前收集，
 *   时点 object-killed）。
 * - 808.2 / 808.2.a：同一永久物上多个 Deathknell 实例各自独立触发，控制者决定入链顺序。
 * - 383.3.e 一族与 2779 段（Red Brambleback 例子）：把某个触发"额外触发一次"是触发收集层面的
 *   修改（trigger multiplicity），不是链条内的重复执行。
 *
 * status: judge-required —— 引擎没有"让触发额外触发一次"的模型：Ability 的六种形状里没有触发
 * 倍率，ContinuousEffect.kind 是开放字符串但没有消费者；keywords/Deathknell.ts 的展开体仍引用
 * 未合入的 trigger.leave 原语（该文件自身注明），触发收集阶段也没有倍率接口。
 * 因此本卡声明一个描述性 static 持续效果（触发倍率 +1，作用于本方 Deathknell），并按
 * README 第 2 节保持 judge-required，不把声明当作可执行。
 * 依赖：RIFT-82（kw-deathknell-legion：Deathknell 完整展开，含 trigger.leave 原语）、
 *       触发收集阶段的倍率接口（events/）。
 */
const karthusEternal = {
  canonicalCardId: "card.hash-f3293211dd6f878acb245cc2cf0f2d2f2b066eed84ddbc009999e2176265a0ae",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "缺「触发额外触发一次」的引擎模型：Ability 六种形状没有触发倍率，ContinuousEffect.kind 无对应消费者，" +
    "keywords/Deathknell.ts 的展开体仍引用未合入的 trigger.leave 原语，触发收集阶段（events/）也没有倍率接口；" +
    "808.1/808.2 与 383.3.e 一族说明该效果作用于触发收集（Deathknell 触发），不能在结算期用 repeat 近似。" +
    "依赖：RIFT-82（kw-deathknell-legion）、触发收集阶段的倍率接口（events/）。",
  sourceText: "Your [Deathknell] effects trigger an additional time.",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.trigger-multiplicity",
        mode: "additional",
        amount: { kind: "constant", value: 1 },
        appliesTo: {
          keyword: "deathknell",
          controller: "controller",
          zone: "board"
        }
      }
    }
  ]
} satisfies CardProgram;

export default karthusEternal;
