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
 * status = judge-required：见 judgeReason。“defends alone” 谓词没有已合入的求值器
 * （Defender 指定不在 ObjectSnapshot 中；契约 3.8 未进当前 HEAD），也没有任何生产方
 * 把卡牌程序的 static 能力注册为图层持续的 continuous.might（契约 3.5/3.7）。
 * 不近似实现。
 */
const wujuBladesmanStarter = {
  canonicalCardId:
    "card.hash-cf38f851f4d3c20ede56526fcc1ad4c1ed2581cc73341deaa53ea09e51c15790",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口，均不属于本卡 write scope：(1)「defends alone」谓词无法求值——它需要 " +
    "(a) 该单位在当前战斗中持有 Defender designation（CR 814.1.d / 466.2.c.3），" +
    "而契约 3.8 的 ObjectSnapshot.combatRole 未进当前 HEAD（interpreter 与 layers 的 " +
    "ObjectSnapshot 都没有该特征）；以及 (b) 同一 location 上没有其他友方单位（CR 740.2.a），" +
    "冻结 ObjectFilter 没有「同 location 存在其他友方单位」型排除条件，layers/filter.ts 的 " +
    "matchesObjectFilter 也不支持；(2) 没有生产方把卡牌的 static 能力注册成 continuous 效果" +
    "（契约 3.5/3.7）：layers/engine.ts 的 addContinuous 只被原语与 chain 调用，" +
    "engine-core src 不读取 CardProgram.abilities，卡牌静态能力接线属 RIFT-91；" +
    "(3) 即使接线，layers/engine.ts 的 conditionMatches 只识别 always/never/type/has-tag/has-keyword，" +
    "未识别的守卫条件按 true 处理，+2 Might 会被无条件套用；且 layers/filter.ts 的 selectorMatches " +
    "用目标对象自身的 controller 作为 owner 去解析过滤器里的 \"self\"，静态光环的「friendly」" +
    "既没有能力控制者可绑定、也不会排除敌方单位，因此该过滤器的语义同样未落地；" +
    "(4) Legend 的来源区域是 Legend Zone" +
    "（CR 107.4.c / 174.2.b），契约 ZoneId（effects/contract.ts）与参考内核都没有该区域，" +
    "静态能力的来源区域也无处声明。依赖：契约 3.8 combatRole、RIFT-91（layers-continuous 条件" +
    "与卡牌静态能力接线）、契约 3.5 的来源区域扩展。不近似实现。",
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
          // PlayerSelector 的契约拼写（= 能力控制者）；静态效果路径目前无法绑定它，见 judgeReason。
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
