import type { CardProgram } from "../../ir/index.js";

/**
 * Decree of Unity (ven-131-166) — Spell, 2 energy + 1 Order power, no tags.
 * Might null（法术无印刷 Might）。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ven-131-166，逐字）:
 *   "Kill an enemy Chaos (:rb_rune_chaos:) unit or gear."
 *
 * 规则依据（CR v1.5）：
 * - "Kill" 是 429.1.a.1 的主动消灭（Kill Instruction），由已合入的 effect.kill 提交封闭
 *   GameAction `kill`（429.2.a：只有起点在 Board 的对象才算被消灭；429.2.b：消灭不是 Move）。
 * - "an enemy … unit or gear"：被点名的对象是目标（355.7/355.9.a.1「"Unit", "gear", … 
 *   指 Board 上的对象」/355.10），单个对象的 "a unit or gear" 是玩家做出的一次选择，
 *   因此是 min 1 / max 1 / selection "one" 的 TargetSpec，而 type: ["unit", "gear"] 表达并集
 *   （已合入的 sfd/detonation-amplifier、sfd/guardian-of-the-passage 采用同一写法）。
 * - "enemy"：控制者是能力控制者的对手（740.1.b），用 controller: "opponent"，由链的 query
 *   归一化解析（自指占位）。
 * - "Chaos" 是领域（134），不是类型：对象所属领域由 ObjectSnapshot.power 承载（163/134.1）。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required。唯一未合入的依赖是领域谓词：
 * 已合入的过滤器匹配器（layers/filter.ts matchesObjectFilter、events/pipeline-match.ts）只读取
 * 固定键（type/types/zone/location/controller/owner/states/tags/characteristics），不读取 
 * power/domain，因此 filter 里的 power: ["Chaos"] 没有消费方，不能把任意敌方 unit/gear 当作
 * 「Chaos」目标结算（依赖 RIFT-359 的条件/目标谓词词表）。
 * 不近似实现：不把 Chaos 写成标签、不用 type 之外的捷径，也不省略该限制。
 */
const decreeOfUnity = {
  canonicalCardId: "card.hash-0e433716a00b8132f28b20fbf6ccf140068457e64d2ef62cba8d491d4396dc15",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "唯一未合入的依赖是「Chaos」领域谓词（134：对象所属领域由 ObjectSnapshot.power 承载）：" +
    "已合入的过滤器匹配器（layers/filter.ts matchesObjectFilter、events/pipeline-match.ts）只读取 " +
    "type/types/zone/location/controller/owner/states/tags/characteristics 等固定键，不读取 power/domain，" +
    "因此 filter 里的 power: [\"Chaos\"] 没有消费方，Finalize 无法按领域限制目标合法性（355.9.b；" +
    "依赖 RIFT-359 的条件/目标谓词词表）。不近似实现：不把 Chaos 写成标签或类型，也不省略该限制" +
    "（省略会把「any enemy unit or gear」错误地当成合法目标）。" +
    "kill 半段（429.1.a.1/429.2.a/429.2.b）与恒为真的目标声明（355.7/355.9.a.1/355.10）本身" +
    "只用已合入的 effect.kill，golden 用真实解释器 + 参考内核执行该半段。",
  abilities: [
    {
      kind: "play",
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: 1 }
      },
      body: [
        {
          // "Kill an enemy Chaos unit or gear"：一个被选目标（355.7/355.9.a.1/355.10）。
          id: "decree-of-unity.kill",
          op: "effect.kill",
          args: { target: { kind: "constant", value: "decree-of-unity.enemy-chaos-object" } },
          targets: [
            {
              id: "decree-of-unity.enemy-chaos-object",
              filter: {
                type: ["unit", "gear"],
                zone: "board",
                controller: "opponent",
                // 134 的 Chaos 领域：待接线的谓词键，见 judgeReason。
                power: ["Chaos"]
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText: "Kill an enemy Chaos (:rb_rune_chaos:) unit or gear."
} satisfies CardProgram;

export default decreeOfUnity;
