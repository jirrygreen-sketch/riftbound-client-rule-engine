import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Akshan, Mischievous (sfd-109-221) — Unit, 4 energy, 无印刷 Power, Might 4，
 * 领域 Body，标签 Akshan / Shurima / Sentinel / Champion。
 *
 * sourceText（packages/card-data/data/deck-catalog.json sfd-109-221，逐字，含换行）：
 *   "[Weaponmaster]
 *    You may pay :rb_rune_body::rb_rune_body: as an additional cost to play me.
 *    When you play me, if you paid the additional cost, move an enemy gear to your base.
 *    You control it until I leave the board.
 *    If it's an Equipment, attach it to me."
 *
 * 规则依据（Core Rules v1.5）：
 * - 821.1：Weaponmaster 是 Triggered Ability 关键词（打出触发、可选用你控制的 Equipment、
 *   支付其 Equip 费并附着）；按 README 第 5 节只声明 { kind: "keyword", keyword: "weaponmaster" }，
 *   展开归 effects/keywords/Weaponmaster.ts；Equip 费用绑定与 [A] 折扣仍见 judgeReason。
 * - 356.2.b / 356.2.b.1："You may pay :rb_rune_body::rb_rune_body: as an additional cost to play me"
 *   是 Optional Additional Cost，是否支付在打出流程第 2 步声明（355.1.a）。按契约 3.1 用描述性
 *   static cost.additional 保留形状（两枚 Body 符文 = 2 Power，allowedDomains: ["Body"]）。
 * - 356.4.f.1："if you paid the additional cost" 只看玩家是否做出支付决定；359.3.e.16 的官方
 *   范例逐字就是本卡（"If Akshan leaves the board in reaction to his play effect, the delayed
 *   passive ability 'You control it until I leave the board,' will not be generated."），因此
 *   「You control it until I leave the board」是与来源在场绑定的持续控制（482.3 的图层到期制）。
 * - 421.1 / 421.2："move an enemy gear to your base" 是 Board 上两个 Location 之间的 Move；
 *   355.5 / 355.9.a.1 使它成为在打出时选定的目标（"gear" 指 Board 上的对象）。
 * - 435.1 / 435.1.f-g："attach it to me" 是 Attach 动作，附着宿主是本单位（"me"）。
 * - 150.1 / 150.4：Equipment 是 Gear 上的标签；"If it's an Equipment" 是对被移动 gear 的标签判定。
 *
 * 当前复核（2026-10-18，逐项实测）：保持 judge-required；具体未接通路径见 judgeReason。
 */
const abilities: Ability[] = [
  { kind: "keyword", keyword: "weaponmaster" },
  {
    // 356.2.b：被打出牌上的 Optional Additional Cost（两枚 Body 符文 = 2 Power）。
    kind: "static",
    effect: {
      kind: "cost.additional",
      id: "akshan-mischievous.additional-cost",
      appliesTo: "self",
      optional: true,
      stage: "optional-additional",
      payments: [
        {
          kind: "power",
          amount: { kind: "constant", value: 2 },
          allowedDomains: ["Body"]
        }
      ]
    }
  },
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body: [
      {
        // 421.1：把敌方 gear 移动到能力控制者的 Base。355.5/355.9.a.1："an enemy gear" 是在打出时
        // 选定的目标。LocationExpr 按能力控制者解析，不读敌方 gear 的控制者。
        id: "akshan-mischievous.move-gear",
        op: "effect.move",
        args: {
          objects: { kind: "constant", value: { target: "akshan-mischievous.enemy-gear" } },
          to: { kind: "location", value: "ability-controller-base" },
          amount: { kind: "constant", value: 1 },
          linkKey: { kind: "constant", value: "moved-gear" }
        },
        targets: [
          {
            id: "akshan-mischievous.enemy-gear",
            // 355.9.a.1："gear" 指 Board 上的对象；"enemy" = 对手控制（controller 占位符由目标管线
            // 在 Finalize 解析，与已合入 rad/one-two-punch 的 "opponent" 写法一致）。
            filter: { type: "gear", zone: "board", controller: "opponent" },
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      },
      {
        // "You control it until I leave the board"：482.3 的持续控制；duration 用 effect.control 支持的
        // { type: "while-source-in-zone" }（原语显式记录本卡与 359.3.e.16）。非永久期限目前被阻断，见 judgeReason。
        id: "akshan-mischievous.take-control",
        op: "effect.control",
        linkedTo: "akshan-mischievous.move-gear",
        args: {
          // "it" = 前述被移动的 gear；用非目标 pick 消费前序 move 的结果（355.7：pick 不构成目标）。
          objects: { kind: "constant", value: { pick: "akshan-mischievous.referenced-gear" } },
          amount: { kind: "constant", value: 1 },
          duration: { kind: "constant", value: { type: "while-source-in-zone" } },
          linkKey: { kind: "constant", value: "controlled-gear" }
        },
        picks: [
          {
            id: "akshan-mischievous.referenced-gear",
            // "it" 直接引用前序 move 的实际结果（359.3.e.14 的链接引用口径）。
            options: [
              {
                kind: "linked-value",
                instructionId: "akshan-mischievous.move-gear",
                key: "moved-gear.objects"
              }
            ],
            min: 1,
            max: 1,
            selection: "one"
          }
        ]
      },
      {
        // "If it's an Equipment, attach it to me."：150.1 的 Equipment 标签判定由本条 instruction 的
        // condition 真实求值——左值 "Equipment" 用 in 测试右值（pick 指向的被移动 gear 的 tags 数组）；
        // 不满足时本条 skipped。宿主是本单位（"me"）。
        id: "akshan-mischievous.attach-gear",
        op: "effect.attach",
        linkedTo: "akshan-mischievous.take-control",
        condition: {
          kind: "compare",
          left: { kind: "constant", value: "Equipment" },
          operator: "in",
          right: {
            kind: "object-property",
            object: { pick: "akshan-mischievous.attached-gear" },
            property: "tags"
          }
        },
        args: {
          // effect.attach names its selections as { kind, id }: the merged
          // primitive accepts source/target/pick/choose in that spelling.
          objects: { kind: "constant", value: { kind: "pick", id: "akshan-mischievous.attached-gear" } },
          host: { kind: "constant", value: { kind: "source" } },
          amount: { kind: "constant", value: 1 },
          linkKey: { kind: "constant", value: "attached-gear" }
        },
        picks: [
          {
            id: "akshan-mischievous.attached-gear",
            options: [
              {
                kind: "linked-value",
                instructionId: "akshan-mischievous.move-gear",
                key: "moved-gear.objects"
              }
            ],
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
  canonicalCardId: "card.hash-237227d339dd27a4f456f9ba38485d4f136673d8abcc77adbca944e2fa427ef8",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "三处当前缺口（2026-10-18 实测；均不近似实现）:" +
    "（1）可选附加费用（356.2.b/356.2.b.1）仍未接通：programs/statics.ts 的 layerFor 对 static cost.additional 抛出 " +
    "\"Static ability kind cost.additional has no layer mapping\"，programs/play.ts 的 translateCost 也拒绝 additional / " +
    "additional-cost 字段；因此费用不能进入 Finalize 的 optionalAdditional，356.4.f.1 的支付决定也没有 CardProgram 回执可读，" +
    "触发体不能无条件移动敌方装备。" +
    "（2）effect.control 对 duration { type: \"while-source-in-zone\" } 仍返回 negated/impossible + blockedReason，缺 479.2.a/482.3 的持续控制到期与底层控制者恢复；359.3.e.16 的官方例子正是本卡。" +
    "（3）Weaponmaster 的 Equip 费用仍无权威绑定：cost.modify 的 reduce-equip-cost 对 source/装备对象形态抛 CostPlanError judge-required（821.1.c.2-.3 的 [A] 不能由普通 allowedDomains 折扣还原），且 cost/plan-values.ts 的 equip payment 仍无读取路径；不能用装备的打出费或普通 Power 折扣代替。",
  abilities,
  sourceText:
    "[Weaponmaster]\n" +
    "You may pay :rb_rune_body::rb_rune_body: as an additional cost to play me.\n" +
    "When you play me, if you paid the additional cost, move an enemy gear to your base. You control it until I leave the board. If it's an Equipment, attach it to me."
} satisfies CardProgram;

export default program;
