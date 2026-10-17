import type { CardProgram } from "../../ir/index.js";

/**
 * Exemplar of Demacia (rad-155-167 / rad-176-167) — Legend, Body/Order, tag Jarvan IV.
 *
 * sourceText（packages/card-data/data/deck-catalog.json rad-155-167，逐字）：
 *   "When you play a gear with [Deploy], you may exhaust me and pay
 *    :rb_rune_rainbow: to move a friendly unit to that battlefield."
 *
 * 规则依据（CR v1.5）：
 * - 383.1 / 383.2.a：“When you play a gear with [Deploy]” 是触发条件；时点 card-played
 *   （events/timing-points.ts 的 card-played，ruleRefs 359 / 383.4.a / 407）。
 *   830.1.a / 830.3：Deploy 是 Gear 上的关键词，且“是否具有 Deploy”是可被其他效果引用的
 *   特征。
 * - 383.3.a / 403.1：“you may” 出现在效果最开头，是触发能力自身的 Finalize 决定
 *   （拒绝则从链上移除），由 TriggeredAbility.optional 承载（契约 3.1；本仓其他传奇
 *   卡一致）。
 * - 383.3.b / 383.3.b.1：“exhaust me and pay :rb_rune_rainbow:” 紧跟在效果开头的
 *   “you may” 之后，因此这个 [do X] 是触发能力的基础费用，必须在 Finalize 支付；415.4 /
 *   415.5 说明横置费用必须能完成。355.10.c.1 指出 “[do X] to [do Y]” 的费用部分不产生目标。
 * - “move a friendly unit to that battlefield”：被移动的友方单位是目标（355.10、355.9.a.1），
 *   目的地是“被打出的那个 [Deploy] 装备所在战场”（即触发事件的物体位置）；421/449 的
 *   Move 语义与限制归 effect.move 与内核。（本卡不是 Recall，不加 recall 模式。）
 *
 * status = judge-required（缺口均不近似实现）：
 * - “[Deploy] 装备”仍无法过滤：ObjectFilter 的公开词汇只有 objectId/cardId/type/controller/
 *   owner/zone/location/states/tags/characteristics，没有 keywords 成员；ObjectSnapshot 虽有
 *   keywords 数组，但触发器过滤读不到它——写入未知成员会被静默忽略（整个过滤器退化成
 *   「任何被打出的装备」），不能作为条件使用；当前触发过滤没有关键词特征读取。
 * - 费用没有可执行路径：当前触发能力费用接口不能消费 cost.pay，[A]（任意域 Power，
 *   163.2.b / 135.2.e.5）在六域封闭的 Domain 集合里无法表达，且契约 ZoneId 没有
 *   Legend Zone（CR 107.4），传奇自身无法作为可横置的费用对象。
 * - “that battlefield” 的目的地缺口已缩小：effect.move 的 to 支持 target.location（从已锁定的
 *   目标读取 LocationRef）。但要指向“被打出装备所在的战场”，需要一个锁定该装备位置的目标；
 *   card-played 事件载荷不出现在 IR 的目标词汇里（ObjectSelector 只有 self/source/target/pick/linked），
 *   所以本卡仍把目的地写成描述性标记，等待事件物体位置绑定。
 * golden 真实执行已有原语的部分（移动的 to/objects 形状可校验；无可独立执行的正文指令）。
 */
export default {
  canonicalCardId:
    "card.hash-aeae869420081de1b84e1b857cd09233807ef065f1a55595f74684bdb08821eb",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口，均不近似实现：（1）“a gear with [Deploy]” 无法过滤——CR 830.1.a/830.3 的 Deploy 是 " +
    "Gear 的关键词特征，但 ObjectFilter 的公开词汇没有 keywords 成员，写进去会被触发匹配器静默忽略" +
    "（当前过滤器没有关键词特征读取），因此不能作为条件。" +
    "（2）效果开头 “you may exhaust me and pay :rb_rune_rainbow:” 按 CR 383.3.b.1 是触发能力的基础费用、" +
    "必须在 Finalize 支付（415.4 / 415.5），但触发能力注册没有把正文里的 cost.pay 转成基础费用计划；" +
    "TriggerRegistration.cost 字段存在但 programs/triggers.ts:32-40 不填（TriggeredAbility IR 也没有 cost 字段，" +
    "ir/types.ts:393-398）；" +
    "[A]（任意域 Power，CR 163.2.b / 135.2.e.5）在六域封闭的 Domain 集合里不可表达；契约 ZoneId 也没有 Legend Zone" +
    "（CR 107.4），传奇自身无法作为横置费用的对象。" +
    "（3）“that battlefield” 没有可执行目的地：effect.move 的 to 只接受字面 LocationRef / controller-base / 字面地点选项，" +
    "不接受 target/pick 描述符；事件物体的位置绑定与 to 的地点来源形式仍缺。" +
    "被移动的友方单位是目标（CR 355.10 / 355.9.a.1），结构已按此声明。" +
    "依赖触发能力基础费用接线、Universal Power/Legend 费用对象，以及事件物体的关键词与位置绑定。",
  abilities: [
    {
      kind: "triggered",
      trigger: {
        at: "card-played",
        filter: {
          event: "card-played",
          // “you play a gear with [Deploy]”：事件物体是你打出的装备。
          object: {
            type: "gear",
            controller: "self",
            // CR 830.3 允许检查“是否具有 Deploy”。合并过滤词汇没有 keywords 成员，
            // 这里仅记录待接线声明，永远不会被当成已求值语义。
            characteristics: { deploy: true }
          }
        }
      },
      // 383.3.a：效果开头的 “you may” 是触发能力自身的决定（Finalize 时选择是否执行）。
      optional: true,
      body: [
        {
          id: "exemplar-of-demacia.pay",
          // 383.3.b：这是触发能力的基础费用，在 Finalize 支付，不是结算指令；
          // cost.pay 已合入，但当前触发能力费用接口不能消费该基础费用；此处只保留可审查的声明。
          op: "cost.pay",
          args: {
            // [A]：任意域 Power（135.2.e.5 / 163.2.b）。六域封闭集合下不可表达，
            // 保留与 danger-zone / daughter-of-the-void 一致的描述性记号。
            power: { kind: "constant", value: ["rainbow"] },
            payments: { kind: "constant", value: [{ kind: "exhaust", object: "self" }] }
          }
        },
        {
          id: "exemplar-of-demacia.move-unit",
          // 383.3.b 的 “to [do Y]”：只有费用成立才执行（359.3.e.14 链接语义）。
          linkedTo: "exemplar-of-demacia.pay",
          op: "effect.move",
          args: {
            objects: {
              kind: "constant",
              value: { target: "exemplar-of-demacia.friendly-unit" }
            },
            // “that battlefield” = 被打出装备所在战场。合并 IR 没有事件物体位置选择器
            // （见 judgeReason），所以这里只是描述性地点标记，不是可执行目的地。
            to: {
              kind: "constant",
              value: { type: "battlefield", id: "that-battlefield" }
            },
            amount: { kind: "constant", value: 1 }
          },
          targets: [
            {
              id: "exemplar-of-demacia.friendly-unit",
              filter: { type: "unit", controller: "controller" },
              min: 1,
              max: 1,
              selection: "one"
            }
          ]
        }
      ]
    }
  ],
  sourceText:
    "When you play a gear with [Deploy], you may exhaust me and pay :rb_rune_rainbow: to move a " +
    "friendly unit to that battlefield."
} satisfies CardProgram;
