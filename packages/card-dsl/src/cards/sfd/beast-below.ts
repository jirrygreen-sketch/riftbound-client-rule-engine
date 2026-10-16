import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Beast Below (sfd-132-221) — Unit, Chaos, tag Bilgewater.
 * energy 7, power 2 (Chaos), Might 8.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, sfd-132-221，逐字）:
 *   "When you play me, return another friendly unit and an enemy unit to their owners' hands."
 *
 * 规则依据（CR v1.5）:
 * - 383.4.a / 383.4.a.1 / 383.4.a.2："When you play me" 是 Play Effect——Condition 含本
 *   单位的触发式能力，在打出完成后作为 Pending Item 进链；时点为 card-played
 *   （events/timing-points.ts，refs 359/383.4.a/407；chain/engine.ts 在单位/法术/装备
 *   结算完成时发射），filter 用符号选择器 { source: "self" } 指称能力来源本身。
 * - "return another friendly unit and an enemy unit"：两个被具体选择的对象，都在 Board
 *   （355.9.a.1 规定未特别说明的 "unit" 指 Board 上的单位、108.2.d 的公开区域），因此按
 *   355.5/355.7/355.10 都是目标（不是非目标 pick）。"another" 排除能力来源自身，用契约
 *   3.6 的 exclude 选择器 "self" 表达；"friendly"/"enemy" 用 controller self/opponent
 *   表达（740.1.a/740.1.b）。"and" 连接两个并列的目标子句，各自声明自己的 TargetSpec。
 * - "to their owners' hands"："return … to hand" 是区域移动（448.2，不是 Move）：已合入的
 *   effect.zone 的 "hand" 目的地提交封闭动作 return-to-hand，由动作层按**拥有者**路由
 *   （每个对象进入其 owner 的手牌，而不是移动者的手牌）——正合 "their owners' hands"。
 * - 结算顺序：两条指令按印刷顺序结算（359.3.d）；被返回的对象同属一套「同时」效果，任一
 *   目标的引用失效只使读取它的那条指令按 359.3.e.7 被忽略，不阻止另一条（055/359.3.e.11）。
 *   两条指令互不读取对方结果，故不写 linkedTo（不是为测试方便强行链接）。
 *
 * status 判定（cards/README.md 第 2 节）：executable。
 * - 触发的封闭时点存在且有发射方（card-played，chain/engine.ts）；filter 的自身绑定沿用
 *   已合入 executable 卡（ven/cloud-drake、ogn/cemetery-attendant）记录同一适配缺口并各自
 *   用 test.todo 标注（RIFT-120 后续）。
 * - 两条正文指令都只用已合入原语 effect.zone（trash/hand 半段与 owner 路由已合入），
 *   解释器 + 参考内核可真实执行，golden 覆盖「另一个友方单位 + 敌方单位双双回手」与
 *   「锁定来源自身时按 exclude 被忽略（fail-closed）」两种边界。
 * - "another"（exclude 锚点）由契约 3.6 定义、由解释器集合查询消费（interpreter/selectors.ts
 *   的 queryObjects）；cards/README.md 第 3 节要求对象引用只写 ObjectSelector，本卡不写运行时
 *   ObjectRef。
 *
 * 已知引擎接线缺口（不属本卡 IR，按 README 第 4 节以 test.todo 记录，不改状态）：CardProgram →
 * TriggerRegistration 的适配器（自身锚点绑定、activeZones、Finalize 目标锁定）属 RIFT-120 后续。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        // "another friendly unit"：由你控制、且不是能力来源本卡（exclude: "self"，
        // 740.1.a 的 "another" 惯例）。区域是 Board（355.9.a.1）。
        id: "beast-below.return-friendly-unit",
        op: "effect.zone",
        args: {
          target: { kind: "constant", value: "beast-below.other-friendly-unit" },
          to: { kind: "constant", value: "hand" },
          amount: { kind: "constant", value: 1 }
        },
        targets: [
          {
            id: "beast-below.other-friendly-unit",
            filter: { type: "unit", controller: "self", zone: "board", exclude: "self" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      },
      {
        // "an enemy unit"：由对手控制（740.1.b）的 Board 单位。
        id: "beast-below.return-enemy-unit",
        op: "effect.zone",
        args: {
          target: { kind: "constant", value: "beast-below.enemy-unit" },
          to: { kind: "constant", value: "hand" },
          amount: { kind: "constant", value: 1 }
        },
        targets: [
          {
            id: "beast-below.enemy-unit",
            filter: { type: "unit", controller: "opponent", zone: "board" },
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
  canonicalCardId: "card.hash-e2b4fefd3d5809000d8c2e95e0323ac6e79155e7f3f1b924a7f1131f22459abb",
  rulesetVersion: "core-1.5" as const,
  status: "executable" as const,
  abilities,
  sourceText: "When you play me, return another friendly unit and an enemy unit to their owners' hands."
} satisfies CardProgram;

export default program;
