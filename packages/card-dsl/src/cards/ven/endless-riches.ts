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
 *   （触发式能力），在打出完成、进入 Board 之后进链；420.4.a 给出同一时点。CardProgram
 *   的触发注册适配器已经能把这一触发接入事件管线，Burn 子效果也有执行证据。
 * - 428.1 / 428.2 / 428.5："banish your hand and trash" 是把这两个区域的牌放进其拥有者的
 *   Banishment；"your hand and trash" 是两组牌的并集，不是目标（355.10.d：整组程序化确定，
 *   没有选择）；"your" 指能力控制者（190.6.d 的隐含 you）。契约 3.6 的 effect.banish 支持
 *   按区域取值（zone 选择），hand 与 trash 由两条独立区域选择表达（108.2.d/108.3 的
 *   区域身份各自独立），两条指令都写在 body 里。
 * - 441.1 / 441.2 / 441.4："[Burn 7]" 把主牌库顶 7 张移入其弃牌区，尽可能多做；
 *   已合入原语 effect.mill 即该动作。
 * - 444.1 / 444.1.a / 444.1.b / 444.2："Skip your Draw Phase" 是把 Draw 阶段的流程
 *   替换为无事发生——它是替代效果（replacement），不是一条结算指令。当前替代匹配器只
 *   消费闭合 GameAction 事件（replacement/pattern.ts 的 ACTION_KINDS），turn/ 尚未提供可匹配的
 *   Draw Phase 流程事件。
 * - 420.1.a：默认只能从手牌或 Chosen Champion Zone 打出；"You may play cards from your trash"
 *   是一条持续许可（permission），把 trash 加入合法打出区域。当前 static binder 的
 *   layerFor() 把未知 kind 直接抛 ProgramBindingError，continuous.play-permission 没有图层映射和
 *   打出流程消费方（golden 实测 bindStatic 抛错，见 reply/测试）。
 * - 369.1（"would … instead" 标识替代效果）："If a card would go to your trash from anywhere
 *   other than your Main Deck, banish it instead" 是替代效果；"other than your Main Deck"
 *   的否定条件需要事件载荷里的来源区域；replacement/pattern.ts 尚未编译通用入区事件与
 *   toZone/fromZone 过滤，更没有 notFromZone 否定匹配。
 *
 * status = judge-required（三处缺口，均不近似实现）：
 * 1. "Skip your Draw Phase" 需要替代能力匹配 Draw Phase 流程事件；当前替代匹配器只消费
 *    闭合 GameAction，turn/ 尚未提供该流程事件；
 * 2. "You may play cards from your trash" 缺带期限的打出许可形状（本卡没有印期限，是持续许可，
 *    现有 static binder 没有 continuous.play-permission 的图层映射；cost/cost-plan.ts 的 Flow 改写只在来源已在 trash 且是法术时生效，
 *    与本卡的通用许可不同）；
 * 3. replacement/pattern.ts 的 ACTION_KINDS 没有 object-enters-zone 键，入 trash 过滤与非 deck
 *    来源过滤（notFromZone）都没有求值形状；replacement/planner.ts 对 effect.banish 直接抛
 *    BlockedReplacementError，不能以普通 move-zone 近似放逐动作及其事件。事件对象链接已支持。
 * 触发注册、hand/trash 放逐和 Burn 7 已有执行路径，剩余三处保持 judge-required。
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
    // turn/ 的 Draw Phase 流程上；替代生命周期已有，但该流程不属于闭合 GameAction。
    kind: "replacement",
    replaces: { event: "phase-procedure", procedure: "draw", player: "self" },
    with: []
  },
  {
    // 420.1.a 的默认合法打出区域是 hand / Chosen Champion Zone；本句把 trash 也加入。
    // 静态 binder 尚无该许可的图层映射，只保留可审查声明。
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
    // （当前 matcher 也未编译通用入区事件），故以描述性键 notFromZone 记录。
    kind: "replacement",
    replaces: {
      event: "object-enters-zone",
      toZone: "trash",
      notFromZone: "deck"
    },
    with: [
      {
        // 428.1：保留放逐动作。replacement.object 链接已经支持；planner 尚不支持
        // effect.banish，不能用普通移区替代其 card-banished 事件。该对象不是目标（355.10.c）。
        id: "endless-riches.banish-instead",
        op: "effect.banish",
        args: {
          objects: { kind: "constant", value: { linked: "replacement.object" } },
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
    "三处缺口（2026-10-18 复核，均为实测）：缺 Draw Phase 流程替代入口（444.1/444.1.a/444.1.b）：本卡的 phase-procedure 替代声明虽能注册，但 " +
    "replacement/pattern.ts 的 ACTION_KINDS 只映射闭合 GameAction，实测 matches(draw)/matches(exhaust) 均为 false，" +
    "turn/ 也没有可匹配的 Draw Phase 流程事件；" +
    "缺 continuous.play-permission 的静态图层映射及通用 trash 打出许可消费（420.1.a）：实测 " +
    "createEngineStaticBinder().bindStatic 抛 ProgramBindingError（Static ability kind continuous.play-permission " +
    "has no layer mapping），cost/cost-plan.ts 的 Flow 改写只覆盖已在 trash 的法术；" +
    "replacement/pattern.ts 的 ACTION_KINDS 无 object-enters-zone 键（该事件永不匹配），也不读 notFromZone 否定来源条件，" +
    "replacement/planner.ts 对 body 里的 effect.banish 直接抛 BlockedReplacementError（Unsupported replacement opcode），" +
    "无法正确拦截“从主牌库之外进入你的弃牌区”的事件（369.1）。",
  abilities,
  sourceText:
    "When you play this, banish your hand and trash, then [Burn 7].\n" +
    "Skip your Draw Phase.\n" +
    "You may play cards from your trash.\n" +
    "If a card would go to your trash from anywhere other than your Main Deck, banish it instead."
} satisfies CardProgram;
