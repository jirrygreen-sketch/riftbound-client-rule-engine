import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Heartening Soul (rad-040-167) — Unit, 7 energy + 1 Calm power, 7 Might.
 *
 * 原文："When you play me, ready a friendly legend.\n"
 *       "Friendly legends have \":rb_exhaust:: Give a unit +3 :rb_might: this turn.\""
 *
 * 规则依据（CR v1.5）：
 * - "When you play me"：Play Effect，时点 card-played（383.4.a / 420.4.a）。
 * - "ready a friendly legend"：355.9.a.4 的 "Legend" 指 Legend Zone 里的传奇，
 *   355.9.a.1 的默认含义不适用于 Legend；图 355.10 的 "Ready a legend" 示例说明这是
 *   目标（选目标），指令用已合入的 effect.ready（416.1）。
 * - "Friendly legends have \"[E]: Give a unit +3 [M] this turn.\""：801.3.a
 *   （其他效果可以授予关键词/能力）；这里授予的是一整条激活能力（费用 [E]），
 *   所需原语是 continuous.grant-ability（ability-templates 的 continuous.keyword 同族，
 *   需要把完整激活能力附加给一组对象。授予的能力体只含"临时 Might +3"，改用已合入的
 *   continuous.might + duration "this-turn"（143.2.a / 475，RIFT-258）。
 *
 * status 判定（README 第 2 节）：judge-required。缺口：
 * 1. `continuous.grant-ability`（把完整激活能力附加给一组对象，保留费用与持续期；
 *    135.4.b / 801.3.a）仍缺少可消费完整 Ability 的绑定形状：关键词授予不能承载一条
 *    带 [E] 费用的激活能力；
 * 2. “friendly legend” 的 Legend Zone 位置绑定尚不在当前 ZoneId/目标选择契约内。
 * 授予能力体本身已改成可执行形状并用真实执行测试覆盖；effect.ready 同样有真实执行证据。
 * 依赖：完整 Ability grant 绑定与 Legend Zone 目标位置契约。
 */

const grantedAbility: Ability = {
  kind: "activated",
  cost: { payments: [{ kind: "exhaust" }] },
  timing: "action",
  body: [
    {
      id: "heartening-soul.granted.give-might",
      op: "continuous.might",
      args: {
        mode: { kind: "constant", value: "add" },
        objects: {
          kind: "constant",
          value: { kind: "target", id: "heartening-soul.granted.unit" }
        },
        amount: { kind: "constant", value: 3 },
        duration: { kind: "constant", value: "this-turn" }
      },
      targets: [
        {
          id: "heartening-soul.granted.unit",
          filter: { type: "unit", zone: "board" },
          min: 1,
          max: 1,
          selection: "one"
        }
      ]
    }
  ]
};

const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self", player: "controller" } }
    },
    optional: false,
    body: [
      {
        id: "heartening-soul.ready-legend",
        op: "effect.ready",
        args: {
          objects: { kind: "constant", value: { kind: "target", id: "heartening-soul.friendly-legend" } },
          amount: { kind: "constant", value: 1 },
          linkKey: { kind: "constant", value: "readiedLegend" }
        },
        targets: [
          {
            id: "heartening-soul.friendly-legend",
            // 355.9.a.4："Legend" 指 Legend Zone 中的传奇；契约的 ZoneId 尚无
            // legend-zone 成员（见 effect.exhaust / effect.stun 的同类注记），
            // 目标合法性与区域由目标系统与图层在 Finalize/Resolve 解析。
            filter: { type: "legend", controller: "controller" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      }
    ]
  },
  {
    kind: "static",
    effect: {
      kind: "continuous.grant-ability",
      ability: grantedAbility,
      filter: { type: "legend", controller: "controller" }
    }
  }
];

const program = {
  canonicalCardId:
    "card.hash-b955ee21fd32d4a00aae0761a6d7f8f66eb03094edf676a34c3e87639045aae1",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「Friendly legends have \"[E]: Give a unit +3 :rb_might: this turn.\"」需要把一条完整激活能力（含 [E] 费用与持续期）附加给一组对象，" +
    "对应的 continuous.grant-ability 需要把完整激活能力（801.3.a / 135.4.b）附加给每个友方传奇，" +
    "而当前绑定形状只能注册图层效果或关键词，无法承载带 [E] 费用的激活能力体。" +
    "授予能力体内的临时 Might 修改现已改用已合入的 continuous.might + duration this-turn（143.2.a / 475，RIFT-258），并有真实执行证据。" +
    "「ready a friendly legend」用已合入的 effect.ready 并有真实执行证据；但 Legend Zone 的位置绑定仍不在当前 ZoneId/目标选择契约内。" +
    "依赖：完整 Ability grant 绑定与 Legend Zone 目标位置契约。不近似实现。",
  abilities,
  sourceText:
    "When you play me, ready a friendly legend.\n" +
    "Friendly legends have \":rb_exhaust:: Give a unit +3 :rb_might: this turn.\""
} satisfies CardProgram;

export default program;
