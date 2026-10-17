import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Graves, Blasting Through (rad-085-167) — Unit, 5 energy + 1 Body power,
 * Might 4, 标签 Bilgewater/Graves/Champion。
 *
 * 原文（packages/card-data/data/deck-catalog.json，sourceText 逐字）：
 *   When I attack or defend, deal damage equal to my Might to all enemy units
 *   here. I don't deal combat damage.
 *
 * 规则依据（CR v1.5）：
 * - "When I attack or defend"：attack-declared / defense-declared 时点（383.4.e/.f、
 *   466.2.c），filter 指向自身。两条时点各写一个触发能力（照 Fiora, Peerless 的
 *   同型先例），各自 once per-combat。
 * - "deal damage equal to my Might"：动态数额用 object-property 取来源当前 Might
 *   （契约 3.6 evaluate 时机）；object 用符号选择器 "source"，由解释器绑定运行时引用。
 * - "all enemy units here"：355.10.d 的"按特征程序化选择的集合"——这些单位**不是目标**
 *   （"Deal damage to all enemy units here" 没有选择动作，"here" 也只是来源位置限制）。
 *   因此本卡**不**把它们写成 TargetSpec/picks（契约 3.9：targets 会触发"成为目标"，
 *   picks 是选择，二者与 each-set 不可互换），而是在 args.appliesTo 里描述该集合
 *   （与 danger-zone 的 each-set 写法同型）；集合解析仍属目标/集合管线缺口。
 * - "I don't deal combat damage"：467.2.c 的伤害分配里本单位的 Might 不计入战斗伤害。
 *   continuous.combat 原语已合入，但它对任何 flags 都返回
 *   negated(impossible)（文件头自述：图层引擎没有 kind "continuous.combat" 的消费分支），
 *   所以该限制仍无载体；把限制写成触发器或结算时动作属禁止的近似实现。
 */
const combatTrigger = (at: "attack-declared" | "defense-declared", id: string): Ability => ({
  kind: "triggered",
  trigger: { at, filter: { self: true }, once: "per-combat" },
  optional: false,
  body: [
    {
      id,
      op: "effect.damage",
      args: {
        amount: { kind: "object-property", object: "source", property: "might" },
        target: { kind: "constant", value: "graves-blasting-through.enemies-here" },
        appliesTo: {
          kind: "constant",
          value: {
            type: "unit",
            controller: "opponent",
            zone: "board",
            sameLocationAs: "self",
            selection: "all"
          }
        }
      }
    }
  ]
});

const abilities: Ability[] = [
  combatTrigger("attack-declared", "graves-blasting-through.blast-attack"),
  combatTrigger("defense-declared", "graves-blasting-through.blast-defend")
];

const program = {
  canonicalCardId: "card.hash-c2e3ab2dd48bf4cc3c4fe3b2d698e6c34817fb574f4787c66b1e3fcefc58cd77",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "「I don't deal combat damage」没有已合入的载体：CR v1.5 467.2.c 的战斗伤害分配按单位的 Might 求和" +
    "伤害，需要抑制本单位战斗伤害贡献的静态限制；continuous.combat 原语已合入但图层/战斗端没有" +
    "消费分支，对任何 flags 都返回 negated(impossible)（文件头自述），故不能把整卡标为可执行。" +
    "两条「When I attack or defend, deal damage equal to my Might to all enemy units here」的另一处缺口是集合形状：" +
    "按 355.10.d 这些单位是程序化集合、不是目标，而 effect.damage 只接受 TargetSpec id，契约缺少" +
    "目标集/查询选择形状（同族先例见 effect.ready 的 query 选择），不能把 each-set 写成 targets 来近似" +
    "（会成为「成为目标」触发）。golden 测试用解释器 + 参考内核真实执行 effect.damage 的伤害主体（目标集由" +
    "测试内核 provision）。依赖：combat 的 continuous.combat 消费方（战斗伤害贡献抑制，467 流程）、" +
    "attack-declared/defense-declared 产出方（combat 角色事务）、effect.damage 的 set/query 选择（契约变更请求）。",
  abilities,
  sourceText:
    "When I attack or defend, deal damage equal to my Might to all enemy units here.\n" +
    "I don't deal combat damage."
} satisfies CardProgram;

export default program;
