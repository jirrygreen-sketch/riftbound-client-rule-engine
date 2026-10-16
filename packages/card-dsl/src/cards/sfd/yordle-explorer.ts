import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Yordle Explorer (sfd-100-221) — Unit, 4 energy, 无印刷 Power, Might 4，
 * 领域 Body，标签 Yordle / Bandle City。
 *
 * sourceText（packages/card-data/data/deck-catalog.json sfd-100-221，逐字）：
 *   "When you play a card with Power cost :rb_rune_rainbow::rb_rune_rainbow: or more, draw 1."
 *
 * 规则依据（Core Rules v1.5）：
 * - 383.1 / 383.2.a / 383.4.a："When you play a card …" 是 Play Effect，时点用封闭枚举里的
 *   "card-played"（359、383.4.a、407）；"you" 指能力控制者（190.6.d），故 filter 的 player
 *   用 "self"（events/pipeline-match.ts 的 playerMatches 比较事件玩家与控制者）。
 * - "with Power cost :rb_rune_rainbow::rb_rune_rainbow: or more"：135.2.e.5 / 135.2.e.5.a 说明
 *   :rb_rune_rainbow: 是任意域 Power，因此这是「被派出牌的印刷 Power cost ≥ 2」这一事件条件的
 *   简称；206.1 规定需要判定卡牌费用时读取印刷（或复制）费用，不读折扣后的总费用。
 * - "draw 1"：effect.draw（414.1/414.3），抽牌者缺省为能力控制者。
 *
 * status 判定（cards/README.md 第 2 节）：judge-required——被派出牌的印刷 Power cost 无法读取：
 * - 触发条件只能写在 TriggerSpec.condition（383.2.a.1：紧跟 Condition 的附加条件从句属于触发
 *   条件），但冻结 Condition 的 Expr 没有「事件对象的印刷费用」读数：object-property 只按契约
 *   3.6 的符号选择器读 self/source/target/pick/linked，而 card-played 事件里刚被打出的牌不是
 *   本能力的 self/source，也不是目标或 pick；CountExpr 的 filter 也不接受费用谓词。
 * - 事件载荷侧同样没有该信息：chain/engine.ts 发出的 card-played 事件只带被打出的对象与玩家
 *   （events/action-adapter.ts 不派生费用字段），ObjectFilter/EventPattern 也没有费用键。
 * - 因此 filter 里的 powerCostGte: 2 是**描述性**键，只记录印刷条件的位置，不被任何匹配器求值
 *   （与已合入 ven/heart-of-the-tempest 的 notFromHand、ogn/ember-monk 的 fromHidden 同型）。
 *   不把该条件近似成恒真、也不把阈值写死成某个域；拿到「事件对象费用谓词」后再复核状态。
 * 依赖：事件载荷/事件对象费用谓词（RIFT-120 后续的目标/事件批次），effect.draw 本体已合入。
 */
const abilities: Ability[] = [
  {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: {
        event: "card-played",
        // 190.6.d："you" 是能力控制者；player 选择符在本仓库既有写法里即 "self"。
        player: "self",
        filter: {
          // 描述性键：印刷 Power cost ≥ 2（135.2.e.5 / 206.1）。冻结 IR 与事件载荷都
          // 没有该读数，见 judgeReason；不写成恒真条件。
          powerCostGte: 2
        }
      }
    },
    optional: false,
    body: [
      {
        id: "yordle-explorer.draw-1",
        op: "effect.draw",
        args: { amount: { kind: "constant", value: 1 } }
      }
    ]
  }
];

const program = {
  canonicalCardId: "card.hash-0bf2f78a39c15787c743ca80bf9a8a0faa2ab20b9e055830b9d7e280dd5469ed",
  rulesetVersion: "core-1.5" as const,
  status: "judge-required" as const,
  judgeReason:
    "触发条件「with Power cost :rb_rune_rainbow::rb_rune_rainbow: or more」无法判定：383.2.a.1 要求该从句在" +
    "触发时作为 TriggerSpec.condition 求值，但冻结 Condition 的 Expr 没有「事件对象的印刷费用」读数——" +
    "object-property 只按契约 3.6 的符号选择器读 self/source/target/pick/linked，而 card-played 事件里刚被打出的" +
    "牌不是本能力的 self/source、也不是目标或 pick；CountExpr 的 filter 同样不接受费用谓词。事件载荷也没有该信息：" +
    "chain/engine.ts 发出的 card-played 事件只带被打出的对象与玩家，ObjectFilter/EventPattern 没有费用键。" +
    "filter 内的 powerCostGte: 2 是描述性键（记录 135.2.e.5 的任意域 Power 与 206.1 的印刷费用读取），" +
    "不被任何匹配器求值，与已合入的 ven/heart-of-the-tempest、ogn/ember-monk 同型；不把条件近似成恒真，" +
    "也不把阈值写死成某个域。effect.draw 本体已合入，golden 真实执行该指令。" +
    "依赖：事件对象费用谓词与 card-played 载荷扩展（RIFT-120 后续）。",
  abilities,
  sourceText: "When you play a card with Power cost :rb_rune_rainbow::rb_rune_rainbow: or more, draw 1."
} satisfies CardProgram;

export default program;
