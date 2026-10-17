import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * CR v1.5 827.1.c.1/.c.2：Empower KeywordDef 与 Kill 非资源费用支付已合入，仍缺
 * KeywordAbility → expandProgram 的费用参数及「选择友方单位作为费用」绑定入口。
 * 355.10.c：作为费用的单位不是目标；不伪造一条启动能力替代关键词。
 * 828.1.b.1 / 442.1.a：+2 Might 用真实 empowered > 0 条件门控，不能把字符串当状态。
 * programs/statics 的条件适配可读取参考内核的计数，公开 ObjectSnapshot 尚未声明该字段。
 * 143.2.a：+2 属算术图层，不是 Buff 计数器；未知依赖仍保持 judge-required。
 */
const abilities: Ability[] = [
  {
    // 印刷费「Kill a friendly unit」见 judgeReason；KeywordAbility 没有 params 字段
    // （契约 3.8.3 的 params 只加在 KeywordDef.expand 的输入上），不伪造第二条启动能力。
    kind: "keyword",
    keyword: "empower"
  },
  {
    // [Empowered][>] I have +2 :rb_might:.
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      amount: { kind: "constant", value: 2 },
      appliesTo: "self"
    },
    condition: {
      kind: "compare",
      left: { kind: "object-property", object: "self", property: "empowered" },
      operator: "gt", right: { kind: "constant", value: 0 }
    }
  }
];

export default {
  canonicalCardId:
    "card.hash-873c8f0234994082b765c3eb70f58d38ed667f83edf9a43739a2a1f28910a0f5",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "Empower KeywordDef、effect.empower 与 827.1.c.1 的未 Empowered 比较限制已合入；" +
    "仍缺 KeywordAbility → programs/keywords.expandProgram 的 params.cost 传递，827.1.c.2 的印刷 Kill a friendly unit " +
    "无法随关键词绑定，且费用中的非目标友方单位选择尚无卡声明入口。Kill 费用规划与支付本体已支持。" +
    "442.1.a/828.1.b.1 的 continuous.might +2 已改用 empowered > 0，并经 programs/statics 的条件绑定读取参考内核状态；" +
    "公开 ObjectSnapshot 契约仍未声明 empowered，正式适配器的状态读取尚无契约保证。" +
    "RIFT-672 模板已通过付费测试法术的真实链路验证原始静态能力在 Empower/Disempower 前后的 +2/0，" +
    "并确认本卡缺失费用的启动失败闭合；RIFT-697 模板再用真实场景链路复核未 Empowered/生效/撤销三个边界与这一失败闭合，" +
    "仍不证明印刷 Kill 费用已接通。",
  abilities,
  sourceText:
    "[Empower] — Kill a friendly unit (Pay the cost: Empower me. Use only if not Empowered.)\n" +
    "[Empowered][>] I have +2 :rb_might:."
} satisfies CardProgram;
