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
 *   展开归 effects/keywords/Weaponmaster.ts（该文件自述仍缺 cost.modify / cost.pay 的接线）。
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
 * status 判定（cards/README.md 第 2 节）：judge-required —— 四处缺口，均不近似实现：
 * 1. 费用与回执：可选附加费用没有收费入口（effects/instructions/ 无 cost.additional / cost.pay；
 *    cost/cost-plan.ts 的 optionalAdditional 只消费调用方传入的 OptionalCostInput），冻结 Condition
 *    也没有读取费用计划结果的来源（调研记为 condition.result），因此无法按 356.4.f.1 开闸；
 *    与 sfd/sea-monkey、sfd/zaun-punk 记录同一缺口（RIFT-89）。
 * 2. 目的地："to your base" 是**能力控制者**的 Base，而 effect.move 的 "controller-base" 按被移动对象
 *    的当前控制者解析（effect.move 源码：player = before.controller），对敌方 gear 会落到对手 Base。
 *    冻结 IR 没有「能力控制者的 Base」这一 LocationRef 表达式，写死座位或写成
 *    { type: "base", player: "controller" } 都会被原语当成真实 PlayerId。本卡只保留描述性目的地
 *    标记（原语会拒绝它而不是落到错误地点），与 rad/cataclysm、rad/demon-shade 同一口径。
 * 3. 持续控制："until I leave the board" 需要一个与来源在场绑定的控制权持续效果。effect.control 接受
 *    duration { type: "while-source-in-zone" } 并显式记录了本卡（含 359.3.e.16 的离场不生成语义），
 *    但该非永久期限目前被原语主动阻断（negated/impossible，blockedReason: Temporary control
 *    requires duration-aware take-control and layered expiry/restoration，479.2.a / 482.3）。
 * 4. 附着门控："If it's an Equipment" 需要对被移动 gear 的 tags 做数组包含判定，冻结 Condition 没有
 *    array-contains（只有 eq/ne/lt/lte/gt/gte/in，in 判的是左值属于右数组），effect.move 也不落标签快照
 *    （sfd/veiled-temple 记录同一缺口）。因此 attach 指令保留形状但不伪造标签判定。
 * golden 用真实原语执行已可执行的部分：effect.move（目的地替换为具体 Base 后）与 effect.attach（宿主为本单位），
 * 未合入依赖写 test.todo。
 * 依赖：RIFT-89（费用与回执）、地点/目标表达式扩展、continuous 控制期限、标签数组包含（契约变更请求）。
 */
/** 描述性目的地标记，不是可执行 LocationRef（见 judgeReason 第 2 点）。 */
const CONTROLLERS_BASE = {
  kind: "destination-selector",
  selector: "ability-controller-base"
} as const;

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
        // 选定的目标。目的地见 judgeReason 第 2 点（描述性标记，fail-closed）。
        id: "akshan-mischievous.move-gear",
        op: "effect.move",
        args: {
          objects: { kind: "constant", value: { target: "akshan-mischievous.enemy-gear" } },
          to: { kind: "constant", value: CONTROLLERS_BASE },
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
        // "If it's an Equipment, attach it to me."：150.1 的 Equipment 标签判定未合入（见 judgeReason
        // 第 4 点），因此本条保留形状但不伪造标签条件；宿主是本单位（"me"）。
        id: "akshan-mischievous.attach-gear",
        op: "effect.attach",
        linkedTo: "akshan-mischievous.take-control",
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
    "四处缺口，均不近似实现：(1) 可选附加费用（2 枚 Body 符文，356.2.b/356.2.b.1）没有收费入口——" +
    "effects/instructions/ 无 cost.additional / cost.pay，cost/cost-plan.ts 的 optionalAdditional 只消费调用方传入的" +
    " OptionalCostInput，冻结 Condition 也没有读取费用计划结果的来源（调研记为 condition.result），无法按 356.4.f.1 开闸" +
    "（与 sfd/sea-monkey、sfd/zaun-punk 同一缺口，RIFT-89）。(2)「move an enemy gear to your base」的目的地不可表达：" +
    "「your base」是能力控制者的 Base，而 effect.move 的 \"controller-base\" 按被移动对象的当前控制者解析" +
    "（对敌方 gear 会落到对手 Base），冻结 IR 没有「能力控制者的 Base」LocationRef 表达式，本卡只保留描述性目的地标记，" +
    "原语会拒绝它而不是落到错误地点（rad/cataclysm、rad/demon-shade 同一口径）。(3)「You control it until I leave the board」" +
    "需要与来源在场绑定的控制期限：effect.control 接受 duration { type: \"while-source-in-zone\" }（原语显式记录本卡与 359.3.e.16），" +
    "但该非永久期限被原语主动阻断（blockedReason: Temporary control requires duration-aware take-control and layered " +
    "expiry/restoration，479.2.a/482.3）。(4)「If it's an Equipment」需要被移动 gear 的标签数组包含判定，" +
    "冻结 Condition 无 array-contains（in 判左值属于右数组），effect.move 也不落标签快照（sfd/veiled-temple 同一缺口）。" +
    "golden 用真实原语执行 effect.move（目的地替换为具体 Base）与 effect.attach（宿主为本单位）两段；其余写 test.todo。" +
    "依赖：RIFT-89（费用与回执）、地点/目标表达式扩展、continuous 控制期限与标签数组包含（契约变更请求）。",
  abilities,
  sourceText:
    "[Weaponmaster]\n" +
    "You may pay :rb_rune_body::rb_rune_body: as an additional cost to play me.\n" +
    "When you play me, if you paid the additional cost, move an enemy gear to your base. You control it until I leave the board. If it's an Equipment, attach it to me."
} satisfies CardProgram;

export default program;
