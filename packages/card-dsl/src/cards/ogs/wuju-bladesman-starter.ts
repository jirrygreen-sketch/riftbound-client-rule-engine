import type { CardProgram } from "../../ir/index.js";

/**
 * Wuju Bladesman, Starter (ogs-019-024) — Legend, Calm/Body, 标签 Master Yi/Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json, ogs-019-024）：
 *   While a friendly unit defends alone, it gets +2 :rb_might:.
 *
 * 规则依据（CR v1.5）：
 * - 363 / 364 / 364.2 / 364.3.a：“While …” 是条件式 Passive Ability（陈述事实）；
 *   持续效果不进链（契约 3.5：持续效果由 layers 按图层计算）。
 * - 740.1.a：friendly = 与控制者同一名玩家（或队友）；190.6.d：隐含 "you" 即
 *   能力控制者；191.1：每名玩家控制自己的 Champion Legend。
 * - 740.2.a："alone" = 同一 location 上没有其他友方单位；"defends" 按 814.1.d
 *   的用词惯例指战斗中取得 Defender designation（466.2.c.3），因此条件是
 *   「该友方单位是防守方且身边没有其他友方单位」。
 * - 契约 3.8：ObjectSnapshot.combatRole 承载当次战斗的 Attacker / Defender 指定。
 * - 契约 3.7 / 3.1：+2 Might 属于 continuous.might 静态效果，由 layers 计算，
 *   卡牌只声明静态能力，不写单卡结算代码。
 * - 174 / 174.6：Legend 可以拥有 Passive Ability；107.4.c / 174.2.b：Legend 始终
 *   留在 Legend Zone。
 *
 * status = judge-required：见 judgeReason。continuous.might 本体、契约 3.8 的
 * combatRole 快照字段与卡牌程序绑定都已合入，但 “defends alone” 谓词仍没有求值器
 * （staticFilter 对 defendsAlone 直接抛 Unsupported static filter field；layers/filter.ts
 * 不读 combatRole/designation，也不支持“同 location 没有其他友方单位”型排除）。不近似实现。
 */
const wujuBladesmanStarter = {
  canonicalCardId:
    "card.hash-cf38f851f4d3c20ede56526fcc1ad4c1ed2581cc73341deaa53ea09e51c15790",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "两处缺口，均不属于本卡 write scope：(1)「defends alone」谓词仍无法求值——它需要 " +
    "(a) 该单位在当前战斗中持有 Defender designation（CR 466.2.c.3 / 814.1.d）：契约 3.8 的 " +
    "ObjectSnapshot.combatRole 已合入（effects/contract.ts）" +
    "并可由参考内核设置，但 programs/statics.ts staticFilter 对 defendsAlone 直接抛 " +
    "Unsupported static filter field defendsAlone，layers/filter.ts 的 matchesObjectFilter " +
    "不读 combatRole，也不存在把 combatRole 暴露给过滤器谓词的接点；" +
    "(b) 同一 location 上没有其他友方单位（CR 740.2.a）：冻结 ObjectFilter 没有该排除型条件，" +
    "matchesObjectFilter 也不支持；(2) Legend 的来源区域是 Legend Zone（CR 107.4.c / 174.2.b），契约 ZoneId（effects/contract.ts）" +
    "与参考内核都没有该区域，静态能力的来源区域也无处声明。" +
    "已合入的部分：continuous.might（RIFT-258）、卡牌静态能力接线（RIFT-257：" +
    "attachProgramLifecycle/bindStaticToLayers 经 evaluateCondition 求静态条件）都已合入。" +
    "依赖：RIFT-91 后续（layers combatRole/排除谓词）、Legend 来源区域扩展" +
    "（契约变更请求）。不近似实现。",
  abilities: [
    {
      kind: "static",
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        amount: { kind: "constant", value: 2 },
        filter: {
          type: "unit",
          // "friendly unit"：controller 的 "self" 是 events/trigger-spec.ts
          // PlayerSelector 的契约拼写（= 能力控制者）；生产 staticFilter 会把它归一化为
          // 来源玩家 ID，再由 layers/filter.ts 做友敌匹配。
          controller: "self",
          zone: "board",
          // 「defends alone」的描述性谓词（Defender designation + 同 location
          // 没有其他友方单位）；当前没有已合入的求值器消费该键，见 judgeReason。
          defendsAlone: true
        }
      }
    }
  ],
  sourceText: "While a friendly unit defends alone, it gets +2 :rb_might:."
} satisfies CardProgram;

export default wujuBladesmanStarter;
