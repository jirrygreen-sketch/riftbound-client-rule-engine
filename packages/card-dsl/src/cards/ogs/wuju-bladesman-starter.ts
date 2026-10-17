import type { CardProgram } from "../../ir/index.js";

/**
 * Wuju Bladesman, Starter (ogs-019-024).
 * CR v1.5 363/364.3.a: conditional Passive Ability, evaluated outside the chain.
 * A friendly defender (466.2.c.3, 814.1.d) is alone if no other friendly unit
 * shares its location (740.2.a). The +2 is an arithmetic continuous.might aura.
 * staticFilter still rejects defendsAlone and cannot bind per-recipient combat
 * and friendly-neighbor tests. Interpreter queries support symbolic location
 * and exclusion anchors, but that does not supply this static aura predicate.
 * Legend Zone source binding also remains absent (107.4.c, 174.2.b/174.6).
 */
const wujuBladesmanStarter = {
  canonicalCardId:
    "card.hash-cf38f851f4d3c20ede56526fcc1ad4c1ed2581cc73341deaa53ea09e51c15790",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺两条生产路径：(1) defends alone（CR 466.2.c.3/814.1.d/740.2.a）的逐接收者静态谓词：programs/statics.ts staticFilter 拒绝 defendsAlone；layers/filter.ts matchesObjectFilter 没有绑定当前接收单位的 combatRole 与同位置其他友方单位计数。解释器已有 sameLocationAs/exclude 锚点，但静态光环未接入该谓词。(2) Legend Zone（CR 107.4.c/174.2.b/174.6）未进入 effects/contract.ts ZoneId，也无该来源区域的静态生命周期绑定。依赖：防守且独自的静态接收者谓词、Legend Zone 生命周期支持（契约变更请求）。",
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
