import type { CardProgram } from "../../ir/index.js";

/**
 * Wuju Bladesman, Starter (ogs-019-024).
 * CR v1.5 363/364.3.a: conditional Passive Ability, evaluated outside the chain.
 * A friendly defender (466.2.c.3, 814.1.d) is alone if no other friendly unit
 * shares its location (740.2.a). The +2 is an arithmetic continuous.might aura.
 *
 * status = judge-required（复核 2026-10-17/18，缺口已实测）：
 * - 已合入且实测可用：static continuous.might 的登记（生产 binder 能注册 arithmetic
 *   层效果）；controller: "self" 的相对归一化（归一为来源玩家 ID）；
 *   layers/filter.ts 的 characteristics 匹配会读 combatRole（对照注册
 *   characteristics: { combatRole: "defender" } 时，友方防守者 +2、友方攻击者与敌方
 *   防守者不变）。
 * - 仍缺两条生产路径（见 judgeReason）：(1) 「defends alone」的逐接收者静态谓词——
 *   staticFilter 直接拒绝 defendsAlone 键；生产 condition 由 bindStaticToLayers 用
 *   abilityEnvironment(engine, source) 求值、只绑定来源自身且忽略接收对象；
 *   exclude 锚点被 staticFilter 拒绝，sameLocationAs 归一出的 location 对象在
 *   layers/filter.ts 的“引用同一性/类型字符串”比较下也无法匹配克隆快照的同位置单位。
 *   (2) Legend Zone（107.4.c、174.2.b、174.6）不在 effects/contract.ts 的 ZoneId
 *   词汇表（"hand" | "deck" | "rune-deck" | "trash" | "banishment" | "board" |
 *   "rune-zone" | "chain"），参考内核的 zone 词汇表同样没有 legend，卡牌无法作为
 *   Legend Zone 来源绑定静态生命周期。
 * 程序保留印刷形状（arithmetic +2、controller self、defendsAlone 描述性键）供审查；
 * 不近似实现。
 */
const wujuBladesmanStarter = {
  canonicalCardId:
    "card.hash-cf38f851f4d3c20ede56526fcc1ad4c1ed2581cc73341deaa53ea09e51c15790",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "复核 2026-10-17/18（均为实测）：已合入部分是 static continuous.might 登记、controller/self 相对归一化与 layers/filter.ts 的 characteristics 消费" +
    "（对照注册 characteristics: { combatRole: 'defender' } 时友方防守者 +2、友方攻击者与敌方防守者不变）。整卡仍不可执行，缺两条生产路径：" +
    "(1) defends alone（CR 466.2.c.3/814.1.d/740.2.a）的逐接收者静态谓词——programs/statics.ts staticFilter 直接拒绝 defendsAlone 键" +
    "（Unsupported static filter field defendsAlone）；生产 condition 由 bindStaticToLayers 以 abilityEnvironment(engine, source) 求值，" +
    "只绑定来源自身、忽略接收对象（把条件换成来源自身可判定的事实即可看到 +2 落到无关友方单位），因此无法表达「接收单位是防守者且同位置无其他友方单位」；" +
    "exclude 锚点同样被 staticFilter 拒绝（需要动态相对过滤器），sameLocationAs 归一出的 location 对象在 layers/filter.ts 的" +
    "引用同一性/类型字符串比较下匹配不到克隆快照的同位置单位（相对锚点与 location 匹配属 RIFT-708 进行中工作，该分支也未实现 alone/友方计数）。" +
    "(2) Legend Zone（CR 107.4.c/174.2.b/174.6）不在 effects/contract.ts 的 ZoneId 词汇表中，参考内核 zone 词汇表也无 legend，" +
    "本卡无法作为 Legend Zone 来源取得静态生命周期绑定。依赖：逐接收者的 combatRole + 同位置友方计数静态谓词（RIFT-708 后续）、" +
    "Legend Zone 生命周期支持（契约变更请求）。不近似实现。",
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
