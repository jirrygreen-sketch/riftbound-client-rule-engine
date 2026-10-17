import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Crimson Pigeons (unl-154-219) — Unit, Order, tags Bird/Noxus.
 * energy 3（power: null，无印刷力量费）, Might 3.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-154-219，逐字）：
 *   I have +2 :rb_might: while I'm attacking with another unit.
 *
 * 规则依据（CR v1.5）：
 * - 143.2.a / 479.4：Might 的增减在算术层生效；+2 是条件式持续修正（364.3 的条件式被动能力），
 *   用 static 能力的 continuous.might + condition 表达。
 * - 807.1.d / 466.2.c.3：攻击者身份（Attacker designation）由 Combat 赋予；740.2.c 的“in combat”
 *   定义要求该单位在战斗中的战场上具有战斗身份。
 * - “with another unit” 需要按“攻击者集合中还有另一个由你控制的单位”来求值：本卡用
 *   count + sameLocationAs/exclude 的锚点记录该条件（355.10.d：此类按特征程序化选出的集合不取目标）。
 *
 * Status: judge-required. Re-checked 2026-10-17 against merged source:
 * the static continuous.might ability binds and evaluates through the production
 * binder + arithmetic layer (probed), and the interpreter query layer consumes
 * sameLocationAs/exclude anchors. The blockers are inside the condition itself:
 * (1) layers/filter.ts (the matcher the static binder and layer engine use) does
 * not read combatRole, so a defender satisfies `combatRole: attacker` — probed
 * true; (2) there is no production Attacker designation producer: ObjectSnapshot
 * carries combatRole and the reference test kernel accepts it, but turn/combat
 * flow never assigns it, so the host half of the condition has no live data;
 * (3) layers/filter.ts receives no relative-player resolution — `controller: "controller"`
 * in a static filter is compared literally, so the "another unit you control"
 * set is not scoped to the host's controller.
 */
const abilities: Ability[] = [
  {
    kind: "static",
    effect: {
      kind: "continuous.might",
      mode: "add",
      layer: "arithmetic",
      amount: { kind: "constant", value: 2 },
      appliesTo: "self"
    },
    condition: {
      kind: "all",
      conditions: [
        {
          kind: "compare",
          left: { kind: "object-property", object: "self", property: "combatRole" },
          operator: "eq",
          right: { kind: "constant", value: "attacker" }
        },
        {
          kind: "compare",
          left: {
            kind: "count",
            subject: "other-attacking-units",
            filter: {
              // 355.10.d：同一战场上的另一个己方攻击单位，不取目标。
              type: "unit",
              controller: "controller",
              zone: "board",
              sameLocationAs: "self",
              exclude: "self",
              combatRole: "attacker"
            }
          },
          operator: "gte",
          right: { kind: "constant", value: 1 }
        }
      ]
    }
  }
];

export default {
  canonicalCardId:
    "card.hash-202a6a8d0996a1526ced8874bdc194188d33ba1a216fb691a29e5fd4a678afd7",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "仍缺三处（2026-10-17 复核，均不近似实现）：" +
    "(1) 攻击者身份的匹配消费（CR 466.2.c.3/807.1.d）：layers/filter.ts 的 matchesObjectFilter 不读取 combatRole，" +
    "静态图层匹配因此把 combatRole: \"attacker\" 当成未知键忽略（实测对 defender 也返回 true）；" +
    "(2) 攻击者身份的生产来源（CR 740.2.c/466.2.c.3）：ObjectSnapshot 有 combatRole 字段、参考内核也能写入，" +
    "但 turn/flow.ts 与 combat/flow.ts 从未在攻击/防守指定时赋值，static 条件的 host 半边没有运行期数据；" +
    "(3) 静态过滤器的相对玩家解析：layers/filter.ts 拿不到能力控制者，filter 里的 controller: \"controller\" 会被字面比较，" +
    "“another unit you control”不能按宿主控制者限定。" +
    "已合入并可执行：static continuous.might 的生产绑定与算术图层求值（探针确认可注册），以及解释器 query 层的 sameLocationAs/exclude 锚点。",
  abilities,
  sourceText: "I have +2 :rb_might: while I'm attacking with another unit."
} satisfies CardProgram;
