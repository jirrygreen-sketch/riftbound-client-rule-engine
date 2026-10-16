import type { Ability, CardProgram } from "../../ir/index.js";

/**
 * Endless Riches (ven-022-166) — Gear, 5 Energy, 1 Fury Power, Might null
 * (no printed Might), Fury, no tags.
 *
 * sourceText（逐字取自 packages/card-data/data/deck-catalog.json, ven-022-166）：
 *   "When you play this, banish your hand and trash, then [Burn 7].\n"
 *   "Skip your Draw Phase.\n"
 *   "You may play cards from your trash.\n"
 *   "If a card would go to your trash from anywhere other than your Main Deck, banish it instead."
 *
 * 规则依据（CR v1.5）：
 * - 383.4.a / 383.4.a.1 / 383.4.a.2："When you play this" 是 Gear 的 Play Effect
 *   （触发式能力），在打出完成、进入 Board 之后进链；420.4.a 给出同一时点。
 * - 428.1 / 428.2 / 428.5："banish your hand and trash" 是把这两个区域的牌放进其拥有者的
 *   Banishment；"your hand and trash" 是两组牌的并集，不是目标（355.10.d：整组程序化确定，
 *   没有选择）；"your" 指能力控制者（190.6.d 的隐含 you）。契约 3.6 的 effect.banish 支持
 *   按区域取值（zone 选择），hand 与 trash 由两条独立区域选择表达（108.2.d/108.3 的
 *   区域身份各自独立），两条指令都写在 body 里。
 * - 441.1 / 441.2 / 441.4："[Burn 7]" 把主牌库顶 7 张移入其弃牌区，尽可能多做；
 *   已合入原语 effect.mill（RIFT-112）即该动作。
 * - 444.1 / 444.1.a / 444.1.b / 444.2："Skip your Draw Phase" 是把 Draw 阶段的流程
 *   替换为无事发生——它是替代效果（replacement），不是一条结算指令；替代的注册与执行
 *   属 events 管线（ReplacementRegistration），CardProgram 的 replacement 数据没有注册方。
 * - 420.1.a：默认只能从手牌或 Chosen Champion Zone 打出；"You may play cards from your trash"
 *   是一条许可（permission），把 trash 加入合法打出区域。它需要一条可注册的“带来源与期限的
 *   打出许可”，契约 3.6/3.1 没有该形状（同 rad/runeblade-anvil、rad/akali-brash 的缺口）。
 * - 369.1（"would … instead" 标识替代效果）："If a card would go to your trash from anywhere
 *   other than your Main Deck, banish it instead" 是替代效果；"other than your Main Deck"
 *   的否定条件需要事件载荷里的来源区域，EventPattern 只有等值 fromZone 匹配（无否定形式）。
 *
 * status = judge-required（四处缺口，均不近似实现）：
 * 1. Play Effect 触发没有注册路径（缺 CardProgram → TriggerRegistration 适配器，RIFT-120
 *    后续），触发不会进链；
 * 2. "Skip your Draw Phase" 需要替代能力的注册与执行（events/ 的 ReplacementRegistration
 *    需要调用方提供 matches/apply 代码，没有任何把 CardProgram 的 replacement 数据接进管线的路径；
 *    同 ogn/otterpus 的缺口），并且被跳过的 Draw 阶段本身由 turn/ 流程拥有；
 * 3. "You may play cards from your trash" 缺带期限的打出许可形状（本卡没有印期限，是持续许可，
 *    但同样没有注册与查询方；cost/cost-plan.ts 的 flow 改写只在来源已在 trash 且是法术时生效，
 *    与本卡的通用许可不同）；
 * 4. "from anywhere other than your Main Deck" 需要事件来源区域的否定匹配，EventPattern 不支持。
 * 依赖：RIFT-120 的触发/替代注册接线、打出许可形状（cost/continuous 批次）、事件载荷扩展。
 * 已合入的部分（effect.banish 的 hand / trash 区域选择、effect.mill 的 Burn 7）由 golden
 * 用真实解释器 + 参考内核执行；这不构成整卡证据，故本卡保持 judge-required。
 */
const abilities: Ability[] = [
  {
    // 383.4.a.1："When you play this" → card-played（自身打出）。
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self", player: "self" } }
    },
    optional: false,
    body: [
      {
        // 428.1/428.5："banish your hand"——整组手牌，程序化确定，不是目标
        // （355.10.d；hand 也不是公开区域，355.10.a）。区域选择由内核按真实区域内容求值。
        id: "endless-riches.banish-hand",
        op: "effect.banish",
        args: {
          objects: { kind: "constant", value: { zone: "hand" } },
          linkKey: { kind: "constant", value: "endlessRichesHand" }
        }
      },
      {
        // "and trash"：第二个区域的同一动作，独立链接键（428.3.a：分开的实例不互相引用）。
        id: "endless-riches.banish-trash",
        op: "effect.banish",
        args: {
          objects: { kind: "constant", value: { zone: "trash" } },
          linkKey: { kind: "constant", value: "endlessRichesTrash" }
        }
      },
      {
        // "then [Burn 7]"：441.1/441.2/441.4，effect.mill 按主牌库顶顺序烧 7 张，不足则尽量多。
        id: "endless-riches.burn-7",
        op: "effect.mill",
        args: { amount: { kind: "constant", value: 7 } }
      }
    ]
  },
  {
    // 444.1 / 444.1.a / 444.1.a.2 / 444.1.b："Skip your Draw Phase" 把 Draw 阶段这一
    // 回合流程（315.4）替换为无事发生。这是替代效果（不是结算指令）；with 为空即
    // 444.1 的 "replacing that event with nothing"。procedure/player 是描述性键：封闭的
    // EventPattern 只有事件载荷字段（无“阶段流程”匹配位），真实注册需把本声明映射到
    // turn/ 发出的 draw-start 阶段流程上（见 judgeReason 2）；当前没有
    // CardProgram → ReplacementRegistration 的任何路径。
    kind: "replacement",
    replaces: { event: "phase-procedure", procedure: "draw", player: "self" },
    with: []
  },
  {
    // 420.1.a 的默认合法打出区域是 hand / Chosen Champion Zone；本句把 trash 也加入。
    // 该许可当前没有可注册形状（见 judgeReason 3），只保留可审查声明。
    kind: "static",
    effect: {
      kind: "continuous.play-permission",
      zone: { kind: "constant", value: "trash" },
      player: { kind: "constant", value: "self" },
      // ContinuousEffect.duration 是字符串字段（来源在 Board 期间生效，365.1）。
      duration: "while-source-in-play"
    }
  },
  {
    // 369.1："If a card would go to your trash … banish it instead" 是替代效果。
    // "from anywhere other than your Main Deck" 的否定来源条件没有可求值形状
    // （EventPattern 只有等值 fromZone），故写成描述性键 notFromZone，不伪造等值匹配。
    kind: "replacement",
    replaces: {
      event: "object-enters-zone",
      toZone: "trash",
      notFromZone: "deck"
    },
    with: [
      {
        // 428.1：改写为放逐。被替代事件的对象由管线绑定（355.10.c：替代效果里的对象
        // 不是目标；事件对象选择符尚未落地，以具名引用记录待接线）。
        id: "endless-riches.banish-instead",
        op: "effect.banish",
        args: {
          objects: { kind: "constant", value: "replaced-event-object" },
          linkKey: { kind: "constant", value: "endlessRichesInstead" }
        }
      }
    ]
  }
];

export default {
  canonicalCardId: "card.hash-6cb9652e425a872a57f461b0814a91ddbb540c9369a2fd1e18215aabfdfef16e",
  rulesetVersion: "core-1.5",
  status: "judge-required",
  judgeReason:
    "四处缺口，均不近似实现：(1) Play Effect（383.4.a.1）触发没有注册路径：没有已合入的 " +
    "CardProgram → TriggerRegistration 适配器（RIFT-120 后续），本卡声明不会进链；" +
    "(2) 『Skip your Draw Phase』是替代效果（444.1/444.1.a/444.1.b：把 Draw 阶段这一流程替换为无事发生），" +
    "events/pipeline.ts 的 ReplacementRegistration 需要调用方提供 matches/apply 代码，没有任何路径把 " +
    "CardProgram 的 replacement 数据注册进管线（同 ogn/otterpus 的缺口），而且被跳过的 Draw 阶段本身由 " +
    "turn/ 流程拥有；" +
    "(3) 『You may play cards from your trash』是带来源的持续打出许可：420.1.a 的默认合法打出区域只有 hand 与 " +
    "Chosen Champion Zone，契约 3.1/3.6 没有可注册的许可形状，cost/cost-plan.ts 的 flow 改写只在来源已在 trash " +
    "且是法术时生效，不能表达通用许可；" +
    "(4) 『from anywhere other than your Main Deck』需要事件来源区域的否定匹配，EventPattern 只有等值 fromZone，" +
    "没有否定形式（程序里以描述性 notFromZone 记录）。" +
    "依赖 RIFT-120 的触发/替代注册接线、打出许可形状与事件载荷扩展（契约变更请求，见回复）。" +
    "已合入部分（effect.banish 的 hand/trash 区域选择、effect.mill 的 Burn 7）由 golden 真实执行，" +
    "但不构成整卡证据，故保持 judge-required。",
  abilities,
  sourceText:
    "When you play this, banish your hand and trash, then [Burn 7].\n" +
    "Skip your Draw Phase.\n" +
    "You may play cards from your trash.\n" +
    "If a card would go to your trash from anywhere other than your Main Deck, banish it instead."
} satisfies CardProgram;
