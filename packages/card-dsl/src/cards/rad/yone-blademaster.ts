import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Yone, Blademaster (rad-181-167, fiora-sfd M1 卡组).
 *
 * 原文（RAD 印刷）："[Weaponmaster]
 *   When I conquer a battlefield that was uncontrolled, deal damage equal to
 *   my Might to an enemy unit in a base."
 *
 * ⚠ 印刷差异（m1-decks.json 标记 non-reminder-printing-difference）：
 *   同一 canonicalCardId 的 sfd-116-221 / sfd-233-221 / sfd-233-star-221 原文为
 *   "When I conquer an open battlefield, deal damage equal to my Might to an
 *   enemy unit in a base."——"uncontrolled"（RAD）与 "open"（SFD）不是提示性
 *   差异（open = 未被占据且未被控制，uncontrolled = 仅未被控制）。本程序按
 *   任务指定的 RAD 印刷原文（uncontrolled）编写；M1 构筑合法性结论见任务
 *   回复（radiance-availability.md：RAD 印刷 2026-10-23 前不可用于构筑）。
 *
 * 规则依据（CR v1.5）：
 * - 821 Weaponmaster：触发能力关键词（打出触发：可选一件你的 Equipment，
 *   按其 Equip 费减 [A] 支付后立即附着到本单位）。以
 *   { kind: "keyword", keyword: "weaponmaster" } 声明，展开由关键词注册表
 *   负责（当前为空，属 RIFT-81~91 缺口）。
 * - "When I conquer …"：征服触发（时点 "conquer"，383.4.c.1 的
 *   "When I conquer" 结构）；filter 的 battlefieldWas: "uncontrolled"
 *   对应 170.11.b 的定义（无人控制）。
 * - "deal damage equal to my Might"：动态数额用 object-property 表达式
 *   取来源单位的当前 Might（结算时求值，契约 3.6 evaluate 时机）；
 *   object 用契约 3.6 的符号选择器 "source"，由解释器绑定运行时引用。
 * - "an enemy unit in a base"：目标 TargetSpec（type: unit,
 *   controller: opponent, location: base）。
 */
const abilities: Ability[] = [
    {
      kind: "keyword",
      keyword: "weaponmaster"
    },
    {
      kind: "triggered",
      trigger: {
        at: "conquer",
        filter: {
          self: true,
          battlefieldWas: "uncontrolled"
        }
      },
      optional: false,
      body: [
        {
          id: "yone-blademaster.deal-might",
          op: "effect.damage",
          args: {
            amount: {
              kind: "object-property",
              object: "source",
              property: "might"
            },
            target: { kind: "constant", value: "enemy-unit-in-base" },
            source: { kind: "constant", value: "self" }
          },
          targets: [
            {
              id: "enemy-unit-in-base",
              filter: {
                type: "unit",
                controller: "opponent",
                location: { type: "base" }
              },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ];

const program = {
  canonicalCardId: "card.hash-292f685c7578235f29f2c362a52c7975eafab592cc437e2445ca68309b294c56",
  rulesetVersion: "core-1.5" as const,
  status: "executable" as const,
  abilities,
  sourceText:
    "[Weaponmaster]\nWhen I conquer a battlefield that was uncontrolled, deal damage equal to my Might to an enemy unit in a base."
} satisfies CardProgram;

export default program;
