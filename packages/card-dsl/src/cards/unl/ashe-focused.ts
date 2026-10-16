import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Ashe, Focused (unl-169-219) — Unit, Order, energy 5, power 1, Might 4,
 * tags Freljord/Ashe/Champion.
 *
 * sourceText（packages/card-data/data/deck-catalog.json, unl-169-219，逐字）:
 *   “When you play me, choose an opponent. They reveal their hand. Choose a card
 *    revealed this way and banish it. When they hold, return it to their hand
 *    (even if I’m no longer on the board.)”
 *
 * 规则依据（CR v1.5）:
 * - 383.4.a / 383.4.a.1：“When you play me” 是 Play Effect，时点 card-played、
 *   filter 指向本卡自身。
 * - “choose an opponent”：355.7 / 355.9.a 把“选择玩家”列为 Targeted；已合入的 IR
 *   没有玩家目标形态（TargetSpec.filter 是 ObjectFilter，ResolveContext 只有
 *   ctx.targets(specId): ObjectRef[]），故本卡按 ogn/sabotage 的既有写法记录形状。
 * - “They reveal their hand”：425.1 / 425.3 / 425.3.a——Reveal 把私有区域的牌对
 *   全体公开，展示整手牌时不带 count；用已合入的 effect.reveal（player + zone
 *   形式，golden 用具体对手真实执行）。
 * - “Choose a card revealed this way and banish it”：355.10.a 的手牌不是公共区域，
 *   所以这里不是目标选择；是结算期的非目标选择（Pick），随后用已合入的
 *   effect.banish 的 choose 选择器（filter + chooser）执行 428.1 的放逐；
 *   choose 的语义是“按区域查询得到候选后由 chooser 选择”，因此“刚刚展示的那些牌”
 *   与 filter 的候选集合是否一致需要上游给出（见 judgeReason 第 2 点）。
 * - “When they hold, return it to their hand”：383.4.d 的 Hold Effect（“they hold”
 *   ＝被选对手固守），返回的是上面被放逐的那张牌；按 391.5 / 391.5.a 这是把两个
 *   能力绑成一组、窗口与被放逐牌绑定的 Delayed Linked Ability（“it” 指同一张牌）。
 * - “(even if I’m no longer on the board)”：359.3.e.13 的最后已知信息——来源离场后
 *   仍须能引用它创建的那张牌。
 *
 * status = judge-required（缺口不近似实现）:
 * 1. 玩家目标/玩家绑定缺失：“choose an opponent”无法提供一个可在后续指令里使用的
 *    PlayerId（没有 target.player 形态，也没有把玩家选择绑定到 effect.reveal 的
 *    player 实参的表达式）；golden 只用具体对手 B 执行 reveal / banish 两段。
 * 2. 延迟关联能力缺失：“When they hold, return it”需要的注册路径不存在：
 *   ResolveContext.registerDelayedTrigger 存在，但 effects/instructions/ 没有卡牌可用的
 *   trigger.delayed op（RIFT-9 清单未注册，ogn/last-caress 与 rad/last-caress 记录同一
 *   缺口），也没有“这次能力放逐的那张牌”的关联窗口（396/397/398 的 Linked Ability
 *   作用域）；effect.banish 写入的链接值 asheBanished 只在本次结算的作用域内可见，
 *   固守发生在之后的回合，无法引用。
 * 3. 固守者范围条件缺失：hold 时点载荷只带固守玩家，没有“该玩家是不是被选对手”的
 *   条件；写成无条件会在任何玩家固守时把牌还回去（错误语义）。
 *
 * 依赖：RIFT-9（trigger.delayed / target.player）、RIFT-90（玩家目标与绑定）、
 * RIFT-120（卡牌触发进链接线）。
 */
const REVEAL_HAND = "ashe-focused.reveal-hand";
const BANISH_CHOSEN = "ashe-focused.banish-chosen";
const RETURN_BANISHED = "ashe-focused.return-banished";

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
        id: REVEAL_HAND,
        op: "effect.reveal",
        args: {
          // “They reveal their hand”：被选对手公开整手牌（425.3.a：不带 count＝
          // 展示区域当前全部牌）；玩家绑定缺口见 judgeReason 第 1 点，这里的
          // “opponent” 是占位（golden 用具体对手 B 执行）。
          player: { kind: "constant", value: "opponent" },
          zone: { kind: "constant", value: "hand" }
        }
      },
      {
        id: BANISH_CHOSEN,
        op: "effect.banish",
        args: {
          objects: {
            kind: "constant",
            value: {
              // 355.10.a：手牌不是公共区域 → 结算期非目标选择；428.1：放逐。
              choose: "ashe-focused.banish-choice",
              // 候选来源是刚才展示的手牌；choose 只接受 filter，无法收窄到“本次
              // 展示的那些引用”，故这里记录形状（见 judgeReason 第 2 点）。
              filter: { zone: "hand", owner: "opponent" },
              chooser: "self",
              visibility: "public"
            }
          },
          amount: { kind: "constant", value: 1 },
          linkKey: { kind: "constant", value: "asheBanished" }
        },
        linkedTo: REVEAL_HAND
      }
    ]
  },
  {
    // 383.4.d / 391.5：
    // “When they hold, return it to their hand”是绑定同一张牌的 Delayed Linked
    // Ability；固守者范围条件与延迟窗口都未合入（见 judgeReason 第 2、3 点），
    // 因此第二条触发只保留可审查形状，不写成无条件近似。
    kind: "triggered",
    trigger: {
      at: "hold",
      filter: { event: "hold", player: "chosen-opponent" }
    },
    optional: false,
    body: [
      {
        id: RETURN_BANISHED,
        op: "effect.zone",
        args: {
          // 448.2：换区不是 Move；108.7.a：进入拥有者手牌——即使本卡已离场
          // （359.3.e.13 的最后已知信息）也不改变目的区域。
          target: { kind: "constant", value: "ashe-focused.banished-card" },
          to: { kind: "constant", value: "hand" },
          amount: { kind: "constant", value: 1 }
        },
        targets: [
          {
            id: "ashe-focused.banished-card",
            // 108.6 / 428.1：放逐区的牌；
            // “banished this way” 的关联窗口见 judgeReason 第 2 点。
            filter: { zone: "banishment" },
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
  canonicalCardId:
    "card.hash-7f00252b4eaff7bcfcf3dff60f4ba8007ee573667f1912bed0ba0a6301e33a27",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "三处缺口：(1)「choose an opponent」按 355.7 / 355.9.a 是玩家目标，但已合入的 IR 没有玩家目标形态" +
    "（TargetSpec.filter 是 ObjectFilter，ResolveContext 只有 ctx.targets(specId): ObjectRef[]），" +
    "也没有把玩家选择绑定到后续指令 player 实参的表达式（ogn/sabotage 同缺口）。" +
    "(2)「When they hold, return it to their hand」需要 391.5 / 391.5.a 的 Delayed Linked Ability：" +
    "ResolveContext.registerDelayedTrigger 存在但没有注册的卡牌 op（RIFT-9 的 trigger.delayed 未注册，" +
    "ogn/last-caress 与 rad/last-caress 同缺口），也没有「这次能力放逐的那张牌」的关联窗口；" +
    "effect.banish 写入的链接值只在本次结算作用域内可见，固守发生在之后的回合，无法用它取回那张牌。" +
    "(3) 固守者范围缺失：hold 时点载荷不带「该玩家是不是被选对手」的条件，写成无条件会在任何玩家固守时" +
    "把牌还回去（错误语义），故第二条触发只保留带占位条件的形状。" +
    "已可执行部分：effect.reveal（425.1 / 425.3 展示整手牌）与 effect.banish 的 choose 选择器（428.1），" +
    "golden 用具体对手与答案真实执行，并覆盖手牌为空时的 negated。" +
    "依赖：RIFT-9（trigger.delayed / target.player）、RIFT-90（玩家目标与绑定）、RIFT-120（卡牌触发进链接线）。",
  abilities,
  sourceText:
    "When you play me, choose an opponent. They reveal their hand. Choose a card revealed this way and banish it. " +
    "When they hold, return it to their hand (even if I'm no longer on the board)."
} satisfies CardProgram;

export default program;
