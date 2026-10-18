export type TimingPointEmitter = "turn" | "combat" | "chain" | "scoring" | "events";

export type TimingPointPayloadType =
  | "turn"
  | "phase"
  | "cleanup"
  | "zone-change"
  | "card-play"
  | "targeting"
  | "object"
  | "attack"
  | "defense"
  | "combat-damage"
  | "showdown"
  | "combat"
  | "chain-item"
  | "control"
  | "scoring"
  | "final-point"
  | "movement"
  | "card-draw"
  | "card-discard"
  | "damage"
  | "stun"
  | "xp"
  | "buff"
  | "empowerment"
  | "contested"
  | "recycle"
  | "reveal"
  | "show-off"
  | "attachment"
  | "might"
  | "ability-activation"
  | "card-look"
  | "combat-result"
  | "point-gain";

export interface TimingPointDefinition {
  readonly id: TimingPointId;
  readonly descriptionZh: string;
  readonly emittedBy: TimingPointEmitter;
  readonly payloadType: TimingPointPayloadType;
  readonly payloadFields?: readonly string[];
  readonly triggerable?: boolean;
  readonly ruleRefs: readonly string[];
  readonly ruleRefVersion: "1.5";
}

type TimingPointDefinitionInput = Omit<TimingPointDefinition, "id"> & {
  readonly id: string;
};

const V15 = "1.5" as const;

export const TIMING_POINT_RULE_SOURCE = Object.freeze({
  version: V15,
  updatedAt: "2026-10-09",
  hub: "https://playriftbound.com/en-us/rules-hub/",
  pdf: "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf",
  sha256: "94d41fee86f88b61c4157c0389c0595d990b98e5b42555c99d9f649ee64d1fec"
});

const timingPoints = [
  {
    id: "turn-start",
    descriptionZh: "新回合开始，回合流程准备进入 Awaken 阶段。",
    emittedBy: "turn",
    payloadType: "turn",
    ruleRefs: ["314", "315"],
    ruleRefVersion: V15
  },
  {
    id: "awaken-start",
    descriptionZh: "Awaken 阶段开始，执行本阶段开始时的流程与触发。",
    emittedBy: "turn",
    payloadType: "phase",
    ruleRefs: ["315.1"],
    ruleRefVersion: V15
  },
  {
    id: "awaken-end",
    descriptionZh: "Awaken 阶段完成并离开该阶段。",
    emittedBy: "turn",
    payloadType: "phase",
    ruleRefs: ["315.1", "315.2"],
    ruleRefVersion: V15
  },
  {
    id: "beginning-start",
    descriptionZh: "Beginning 阶段开始，执行该阶段的开始步骤。",
    emittedBy: "turn",
    payloadType: "phase",
    ruleRefs: ["315.2.a.1"],
    ruleRefVersion: V15
  },
  {
    id: "beginning-end",
    descriptionZh: "Beginning 阶段完成并离开该阶段。",
    emittedBy: "turn",
    payloadType: "phase",
    ruleRefs: ["315.2.b", "315.3"],
    ruleRefVersion: V15
  },
  {
    id: "channel-start",
    descriptionZh: "Channel 阶段开始，执行该阶段的资源流程。",
    emittedBy: "turn",
    payloadType: "phase",
    ruleRefs: ["315.3"],
    ruleRefVersion: V15
  },
  {
    id: "channel-end",
    descriptionZh: "Channel 阶段完成并离开该阶段。",
    emittedBy: "turn",
    payloadType: "phase",
    ruleRefs: ["315.3", "315.4"],
    ruleRefVersion: V15
  },
  {
    id: "draw-start",
    descriptionZh: "Draw 阶段开始并进入抽牌流程。",
    emittedBy: "turn",
    payloadType: "phase",
    ruleRefs: ["315.4"],
    ruleRefVersion: V15
  },
  {
    id: "draw-end",
    descriptionZh: "Draw 阶段完成并离开该阶段。",
    emittedBy: "turn",
    payloadType: "phase",
    ruleRefs: ["315.4", "316.1"],
    ruleRefVersion: V15
  },
  {
    id: "main-start",
    descriptionZh: "Main 阶段开始，开放本阶段的行动流程。",
    emittedBy: "turn",
    payloadType: "phase",
    ruleRefs: ["316.1", "316.4"],
    ruleRefVersion: V15
  },
  {
    id: "main-end",
    descriptionZh: "Main 阶段完成并离开该阶段。",
    emittedBy: "turn",
    payloadType: "phase",
    ruleRefs: ["316.5", "317"],
    ruleRefVersion: V15
  },
  {
    id: "turn-end",
    descriptionZh: "本回合的流程到达结束时点，随后进入清理。",
    emittedBy: "turn",
    payloadType: "turn",
    ruleRefs: ["317.1.a"],
    ruleRefVersion: V15
  },
  {
    id: "cleanup-start",
    descriptionZh: "清理开始，按顺序处理胜负、战斗身份与待处理状态；不限于回合结束。",
    emittedBy: "turn",
    payloadType: "cleanup",
    ruleRefs: ["318", "323"],
    ruleRefVersion: V15
  },
  {
    id: "cleanup-end",
    descriptionZh: "本次清理任务完成，继续 HOT FEPR；只有结束阶段的清理完成后才推进回合。",
    emittedBy: "turn",
    payloadType: "cleanup",
    ruleRefs: ["322", "334.2"],
    ruleRefVersion: V15
  },
  {
    id: "object-enters-zone",
    descriptionZh: "游戏对象进入一个区域。具体区域由事件载荷携带。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["105", "107", "108", "383.2.c"],
    ruleRefVersion: V15
  },
  {
    id: "object-leaves-zone",
    descriptionZh: "游戏对象离开一个区域。具体区域由事件载荷携带。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["105", "107", "108", "383.2.c"],
    ruleRefVersion: V15
  },
  {
    id: "object-enters-board",
    descriptionZh: "游戏对象进入 Board。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["107", "359.2"],
    ruleRefVersion: V15
  },
  {
    id: "object-leaves-board",
    descriptionZh: "游戏对象离开 Board；其自身离场触发在替代处理后、实际换区前收集，并保存最后已知信息。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["383.2.c.3", "383.2.c.3.a", "383.2.c.3.b", "429.1"],
    ruleRefVersion: V15
  },
  {
    id: "object-enters-battlefield",
    descriptionZh: "游戏对象进入一个 Battlefield。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["107.2", "421.1", "359.2.c"],
    ruleRefVersion: V15
  },
  {
    id: "object-leaves-battlefield",
    descriptionZh: "游戏对象离开一个 Battlefield。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["107.2", "421.1", "429.1"],
    ruleRefVersion: V15
  },
  {
    id: "object-enters-base",
    descriptionZh: "游戏对象进入一个 Base。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["107.1", "359.2.c", "457"],
    ruleRefVersion: V15
  },
  {
    id: "object-leaves-base",
    descriptionZh: "游戏对象离开一个 Base。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["107.1", "421.1", "429.1"],
    ruleRefVersion: V15
  },
  {
    id: "object-enters-deck",
    descriptionZh: "游戏对象进入牌库。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["108.4", "417.1.a"],
    ruleRefVersion: V15
  },
  {
    id: "object-leaves-deck",
    descriptionZh: "游戏对象离开牌库。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["108.4", "414.1.a"],
    ruleRefVersion: V15
  },
  {
    id: "object-enters-hand",
    descriptionZh: "游戏对象进入手牌。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["108.7", "414.1"],
    ruleRefVersion: V15
  },
  {
    id: "object-leaves-hand",
    descriptionZh: "游戏对象离开手牌。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["108.7", "423.1"],
    ruleRefVersion: V15
  },
  {
    id: "object-enters-rune-deck",
    descriptionZh: "游戏对象进入符文牌库。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["108.5", "417.1.b"],
    ruleRefVersion: V15
  },
  {
    id: "object-leaves-rune-deck",
    descriptionZh: "游戏对象离开符文牌库。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["108.5", "431.1"],
    ruleRefVersion: V15
  },
  {
    id: "object-enters-rune-zone",
    descriptionZh: "符文对象进入基地中的符文所在区域（保留既有 rune-zone 标识）。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["107.1", "431.1"],
    ruleRefVersion: V15
  },
  {
    id: "object-leaves-rune-zone",
    descriptionZh: "符文对象离开基地中的符文所在区域（保留既有 rune-zone 标识）。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["107.1", "417.1.b"],
    ruleRefVersion: V15
  },
  {
    id: "object-enters-trash",
    descriptionZh: "游戏对象进入 Trash。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["108.2", "423.1", "429.1"],
    ruleRefVersion: V15
  },
  {
    id: "object-leaves-trash",
    descriptionZh: "游戏对象离开 Trash。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["108.2", "417.1"],
    ruleRefVersion: V15
  },
  {
    id: "object-enters-banishment",
    descriptionZh: "游戏对象进入 Banishment。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["108.6", "428.1"],
    ruleRefVersion: V15
  },
  {
    id: "object-leaves-banishment",
    descriptionZh: "游戏对象离开 Banishment。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["108.6", "383.2.c"],
    ruleRefVersion: V15
  },
  {
    id: "object-enters-chain",
    descriptionZh: "游戏对象进入 Chain。",
    emittedBy: "chain",
    payloadType: "zone-change",
    ruleRefs: ["108.1", "354", "401"],
    ruleRefVersion: V15
  },
  {
    id: "object-leaves-chain",
    descriptionZh: "游戏对象离开 Chain。",
    emittedBy: "chain",
    payloadType: "zone-change",
    ruleRefs: ["108.1", "359.2", "340.1"],
    ruleRefVersion: V15
  },
  {
    id: "card-played",
    descriptionZh: "一张牌成功完成打出并产生打出事件。",
    emittedBy: "events",
    payloadType: "card-play",
    ruleRefs: ["359", "383.4.a", "407"],
    ruleRefVersion: V15
  },
  {
    id: "became-target",
    descriptionZh: "一个对象在选择目标时成为目标。",
    emittedBy: "events",
    payloadType: "targeting",
    ruleRefs: ["355.7", "383.4.b"],
    ruleRefVersion: V15
  },
  {
    id: "object-killed",
    descriptionZh: "对象被消灭并将送入 Trash；自身死亡触发在替代处理后、实际换区前收集，替代掉死亡则不触发。",
    emittedBy: "events",
    payloadType: "object",
    ruleRefs: ["429.1", "429.2", "808.1.d", "808.1.d.1", "808.1.d.2"],
    ruleRefVersion: V15
  },
  {
    id: "object-readied",
    descriptionZh: "一个对象变为 Ready。",
    emittedBy: "events",
    payloadType: "object",
    ruleRefs: ["416.1", "416.1.c"],
    ruleRefVersion: V15
  },
  {
    id: "object-exhausted",
    descriptionZh: "一个对象变为 Exhausted。",
    emittedBy: "events",
    payloadType: "object",
    ruleRefs: ["415.1", "415.1.c"],
    ruleRefVersion: V15
  },
  {
    id: "attack-declared",
    descriptionZh: "玩家或单位取得 Attacker 身份；战斗中后来取得身份也产生攻击触发。",
    emittedBy: "combat",
    payloadType: "attack",
    ruleRefs: ["323.2", "383.4.e", "466.2.c"],
    ruleRefVersion: V15
  },
  {
    id: "defense-declared",
    descriptionZh: "玩家或单位取得 Defender 身份；战斗中后来取得身份也产生防守触发。",
    emittedBy: "combat",
    payloadType: "defense",
    ruleRefs: ["323.2", "383.4.f", "466.2.c"],
    ruleRefVersion: V15
  },
  {
    id: "showdown-open",
    descriptionZh: "Showdown 开启，进入 Showdown Open 状态。",
    emittedBy: "combat",
    payloadType: "showdown",
    ruleRefs: ["345", "466.2.b"],
    ruleRefVersion: V15
  },
  {
    id: "combat-damage-before",
    descriptionZh: "战斗伤害分配完成、实际造成伤害之前。",
    emittedBy: "combat",
    payloadType: "combat-damage",
    ruleRefs: ["467.2.c", "467.2.c.1.a"],
    ruleRefVersion: V15
  },
  {
    id: "combat-damage-after",
    descriptionZh: "战斗伤害实际同时造成之后。",
    emittedBy: "combat",
    payloadType: "combat-damage",
    ruleRefs: ["467.2.d", "467.3"],
    ruleRefVersion: V15
  },
  {
    id: "showdown-close",
    descriptionZh: "Showdown 关闭并完成该次 Showdown 的收束流程。",
    emittedBy: "combat",
    payloadType: "showdown",
    ruleRefs: ["347.2.a", "467.2"],
    ruleRefVersion: V15
  },
  {
    id: "combat-end",
    descriptionZh: "一次 Combat 流程完成。",
    emittedBy: "combat",
    payloadType: "combat",
    ruleRefs: ["468.7", "468.7.b"],
    ruleRefVersion: V15
  },
  {
    id: "chain-item-pending",
    descriptionZh: "链项进入 Pending，等待 HOT FEPR 处理。",
    emittedBy: "chain",
    payloadType: "chain-item",
    ruleRefs: ["354.2", "401", "383.3"],
    ruleRefVersion: V15
  },
  {
    id: "chain-item-finalize",
    descriptionZh: "链项进入 Finalize，检查费用、要求、限制与目标。",
    emittedBy: "chain",
    payloadType: "chain-item",
    ruleRefs: ["337.1", "355", "356", "357", "358", "359.1"],
    ruleRefVersion: V15
  },
  {
    id: "chain-item-resolve",
    descriptionZh: "链项进入 Resolve，按顺序执行其能力。",
    emittedBy: "chain",
    payloadType: "chain-item",
    ruleRefs: ["337.2", "340.1", "359.3.d", "407"],
    ruleRefVersion: V15
  },
  {
    id: "control-established",
    descriptionZh: "一个 Battlefield 建立或重新建立控制。",
    emittedBy: "scoring",
    payloadType: "control",
    ruleRefs: ["190.4", "468.5"],
    ruleRefVersion: V15
  },
  {
    id: "control-lost",
    descriptionZh: "一个 Battlefield 失去控制。",
    emittedBy: "scoring",
    payloadType: "control",
    ruleRefs: ["190.4.c", "323.5"],
    ruleRefVersion: V15
  },
  {
    id: "conquer",
    descriptionZh: "一个 Battlefield 发生 Conquer。",
    emittedBy: "scoring",
    payloadType: "scoring",
    ruleRefs: ["468.5.d", "471.1", "473.2.a"],
    ruleRefVersion: V15
  },
  {
    id: "hold",
    descriptionZh: "回合玩家在 Beginning 的计分步骤中固守 Battlefield。",
    emittedBy: "scoring",
    payloadType: "scoring",
    ruleRefs: ["315.2.b.2", "471.2", "473.2.b"],
    ruleRefVersion: V15
  },
  {
    id: "score",
    descriptionZh: "Battlefield 经 Conquer 或 Hold 被计分；与获得点数分开，即使未获得点数也产生计分触发。",
    emittedBy: "scoring",
    payloadType: "scoring",
    ruleRefs: ["470.1", "470.3", "471", "473.2"],
    ruleRefVersion: V15
  },
  {
    id: "final-point",
    descriptionZh: "得分动作满足 Final Point 检查所需的时点。",
    emittedBy: "scoring",
    payloadType: "final-point",
    ruleRefs: ["473.1.b", "473.1.b.1", "474"],
    ruleRefVersion: V15
  },
  {
    id: "object-moved",
    descriptionZh: "成功完成 Move；用起止地点种类及 id 区分基地到战场、战场到基地、战场到战场。Recall、入场和 Attach 不算 Move。",
    emittedBy: "events",
    payloadType: "movement",
    payloadFields: ["actionId", "batchId", "playerId", "objectId", "controllerId", "fromKind", "fromLocationId", "toKind", "toLocationId", "cause"],
    ruleRefs: ["421.1", "449.1", "449.2", "458", "435.4.a"],
    ruleRefVersion: V15
  },
  {
    id: "card-drawn",
    descriptionZh: "成功抽取一张牌；批次 id 与本回合抽牌序号用于第二张及一次抽取多张的过滤。",
    emittedBy: "events",
    payloadType: "card-draw",
    payloadFields: ["actionId", "batchId", "playerId", "cardId", "fromZone", "drawIndexThisTurn"],
    ruleRefs: ["414.1", "414.4", "383.1.b"],
    ruleRefVersion: V15
  },
  {
    id: "card-discarded",
    descriptionZh: "弃牌已发生并从手牌进入 Trash；不把 Burn、Kill 或一般进入 Trash 当作弃牌。",
    emittedBy: "events",
    payloadType: "card-discard",
    payloadFields: ["actionId", "batchId", "playerId", "cardId", "ownerId", "cause"],
    ruleRefs: ["423.1", "423.1.b", "423.3", "423.4"],
    ruleRefVersion: V15
  },
  {
    id: "damage-dealt",
    descriptionZh: "实际造成正整数伤害后发出，包含战斗与非战斗来源；伤害分配、零伤害及完全被防止的伤害不产生此时点。",
    emittedBy: "events",
    payloadType: "damage",
    payloadFields: ["actionId", "batchId", "playerId", "sourceId", "targetId", "amount", "combatId"],
    ruleRefs: ["418.1.a", "418.1.b", "418.1.e", "418.1.e.1", "467.2.d"],
    ruleRefVersion: V15
  },
  {
    id: "unit-stunned",
    descriptionZh: "单位从未 Stunned 变为 Stunned；对已 Stunned 的单位再次执行 Stun 不发出。",
    emittedBy: "events",
    payloadType: "stun",
    payloadFields: ["actionId", "batchId", "playerId", "sourceId", "unitId", "controllerId"],
    ruleRefs: ["424.1", "424.1.a.1"],
    ruleRefVersion: V15
  },
  {
    id: "xp-gained",
    descriptionZh: "玩家成功获得 XP 后发出，携带实际增加量及前后总量。",
    emittedBy: "events",
    payloadType: "xp",
    payloadFields: ["actionId", "playerId", "sourceId", "amount", "previousXp", "currentXp"],
    ruleRefs: ["730.1", "823.1.c.1"],
    ruleRefVersion: V15
  },
  {
    id: "buff-added",
    descriptionZh: "成功放置 Buff counter 后发出；未放置 counter 不发出，不把一般 Might 增加当作 Buff。",
    emittedBy: "events",
    payloadType: "buff",
    payloadFields: ["actionId", "batchId", "playerId", "sourceId", "unitId", "counterId"],
    ruleRefs: ["427.1", "427.1.b", "427.1.c"],
    ruleRefVersion: V15
  },
  {
    id: "buff-spent",
    descriptionZh: "成功 Spend 一个 Buff counter 后发出；离场清除 Buff 与 Spend 分开。",
    emittedBy: "events",
    payloadType: "buff",
    payloadFields: ["actionId", "playerId", "sourceId", "unitId", "counterId"],
    ruleRefs: ["702.2.b", "705"],
    ruleRefVersion: V15
  },
  {
    id: "empowered-changed",
    descriptionZh: "Empower 或 Disempower 成功改变状态或状态实例数量；无效果的重复指令不发出。成为 Empowered 的触发需过滤增加方向。",
    emittedBy: "events",
    payloadType: "empowerment",
    payloadFields: ["actionId", "batchId", "playerId", "sourceId", "objectId", "previousCount", "currentCount", "cause"],
    ruleRefs: ["442.1", "442.1.c.1", "442.2.a", "443.1", "828.1.c"],
    ruleRefVersion: V15
  },
  {
    id: "contested-applied",
    descriptionZh: "内部流程为 Battlefield 应用 Contested 状态；规则禁止卡牌效果引用该状态。",
    emittedBy: "scoring",
    payloadType: "contested",
    payloadFields: ["battlefieldId", "playerId", "unitId", "cause"],
    triggerable: false,
    ruleRefs: ["190.3.a", "190.3.a.1", "190.3.a.2", "190.3.d"],
    ruleRefVersion: V15
  },
  {
    id: "contested-removed",
    descriptionZh: "内部流程清除 Contested；不等同于 Control 改变，规则禁止卡牌效果引用该状态。",
    emittedBy: "scoring",
    payloadType: "contested",
    payloadFields: ["battlefieldId", "playerId", "cause"],
    triggerable: false,
    ruleRefs: ["190.3.b", "190.3.b.1", "190.3.d", "323.10", "468.5.a"],
    ruleRefVersion: V15
  },
  {
    id: "card-recycled",
    descriptionZh: "卡牌或符文成功 Recycle 后发出，区分 Main Deck 与 Rune Deck，并保留同一指令批次。",
    emittedBy: "events",
    payloadType: "recycle",
    payloadFields: ["actionId", "batchId", "playerId", "cardId", "ownerId", "fromZone", "toDeck"],
    ruleRefs: ["417.1", "417.1.a", "417.1.b", "417.5", "417.5.a"],
    ruleRefVersion: V15
  },
  {
    id: "card-banished",
    descriptionZh: "卡牌成功 Banish 后发出；与 Kill、Discard 分开，保留原区域及所有者供触发过滤。",
    emittedBy: "events",
    payloadType: "zone-change",
    payloadFields: ["actionId", "batchId", "playerId", "cardId", "ownerId", "fromZone"],
    ruleRefs: ["428.1", "428.2", "428.2.a", "428.2.b"],
    ruleRefVersion: V15
  },
  {
    id: "card-revealed",
    descriptionZh: "规则指令 Reveal 卡牌后发出；卡牌仍在原区域，私人自愿展示不算 Reveal。",
    emittedBy: "events",
    payloadType: "reveal",
    payloadFields: ["actionId", "batchId", "playerId", "cardId", "zone", "duration"],
    ruleRefs: ["425.1.a.1", "425.1.a.2", "425.2.b"],
    ruleRefVersion: V15
  },
  {
    id: "objects-shown-off",
    descriptionZh: "Finalize 中完成 Show Off 选择后记录关联对象及其当时信息；可包含手牌及场上对象，不保证发生 Reveal。",
    emittedBy: "chain",
    payloadType: "show-off",
    payloadFields: ["chainItemId", "keywordInstanceId", "playerId", "objectIds", "revealedCardIds", "snapshots"],
    ruleRefs: ["832.1.c", "832.1.c.2", "832.1.c.3", "832.1.d.1"],
    ruleRefVersion: V15
  },
  {
    id: "card-hidden",
    descriptionZh: "Hide 成功将卡牌放入 Battlefield 的 Facedown Zone 后发出；不是进入 Battlefield 地点。",
    emittedBy: "events",
    payloadType: "zone-change",
    payloadFields: ["actionId", "playerId", "cardId", "fromZone", "battlefieldId"],
    ruleRefs: ["422.1", "107.3.a", "107.3.e"],
    ruleRefVersion: V15
  },
  {
    id: "card-burned",
    descriptionZh: "Burn 成功将 Main Deck 顶的牌放入 Trash 后发出；不把 Burn 当作 Discard。",
    emittedBy: "events",
    payloadType: "zone-change",
    payloadFields: ["actionId", "batchId", "playerId", "cardId", "ownerId"],
    ruleRefs: ["441.1", "441.1.a"],
    ruleRefVersion: V15
  },
  {
    id: "cards-looked-at",
    descriptionZh: "效果允许指定玩家查看卡牌后记录可见对象；不向其他玩家披露私有卡牌信息，也不隐含 Reveal。",
    emittedBy: "events",
    payloadType: "card-look",
    payloadFields: ["actionId", "playerId", "cardIds", "zone", "visibility"],
    ruleRefs: ["128.4", "383.2.c", "432.1.c"],
    ruleRefVersion: V15
  },
  {
    id: "object-attached",
    descriptionZh: "成功 Attach 到新的 Top-Most Card 后发出；再次附着当前对象不发出，位置随附着改变不算 Move。",
    emittedBy: "events",
    payloadType: "attachment",
    payloadFields: ["actionId", "playerId", "objectId", "previousTopMostCardId", "topMostCardId", "locationId"],
    ruleRefs: ["435.1", "435.1.g", "435.3", "435.4.a"],
    ruleRefVersion: V15
  },
  {
    id: "might-changed",
    descriptionZh: "单位的有效 Might 改变后发出；前后值用于变为 Mighty、达到阈值与减少 Might 的过滤。",
    emittedBy: "events",
    payloadType: "might",
    payloadFields: ["actionId", "playerId", "sourceId", "unitId", "previousMight", "currentMight"],
    ruleRefs: ["143.2", "383.2.c", "708", "709"],
    ruleRefVersion: V15
  },
  {
    id: "ability-activated",
    descriptionZh: "启动能力完成合法打出流程后发出；取消或未成功完成费用及合法性检查不算使用能力。",
    emittedBy: "chain",
    payloadType: "ability-activation",
    payloadFields: ["chainItemId", "playerId", "sourceId", "abilityId"],
    ruleRefs: ["400", "402", "405", "406", "407"],
    ruleRefVersion: V15
  },
  {
    id: "combat-start",
    descriptionZh: "战斗开启并执行战斗开始效果；同时开启的 Combat Showdown 也产生 showdown-open。",
    emittedBy: "combat",
    payloadType: "combat",
    payloadFields: ["combatId", "battlefieldId", "attackerId", "defenderId"],
    ruleRefs: ["466.1", "466.2.b"],
    ruleRefVersion: V15
  },
  {
    id: "combat-result",
    descriptionZh: "战斗清理后判定结果；玩家与单位的胜、负或 No Result 在 Control 建立与 combat-end 之前确定。",
    emittedBy: "combat",
    payloadType: "combat-result",
    payloadFields: ["combatId", "battlefieldId", "winnerId", "loserId", "unitResults", "noResult"],
    ruleRefs: ["468.3.a", "468.3.b", "468.3.c", "468.3.d", "468.4"],
    ruleRefVersion: V15
  },
  {
    id: "points-gained",
    descriptionZh: "玩家成功获得点数后发出；卡牌写明获得点数与 Battlefield 被计分是不同事件。",
    emittedBy: "scoring",
    payloadType: "point-gain",
    payloadFields: ["playerId", "sourceId", "amount", "previousPoints", "currentPoints", "battlefieldId"],
    ruleRefs: ["470.1", "470.2", "473.1"],
    ruleRefVersion: V15
  }
] as const satisfies readonly TimingPointDefinitionInput[];

export type TimingPointId = (typeof timingPoints)[number]["id"];

export const TIMING_POINTS = Object.freeze(timingPoints) as readonly TimingPointDefinition[];

export const TIMING_POINT_IDS = Object.freeze(
  TIMING_POINTS.map(point => point.id)
) as readonly TimingPointId[];

/**
 * EventPattern names are intentionally allowed to use either the timing-point
 * spelling (for example `conquer`) or the event spelling used by a producer
 * and by card text (for example `conquered`).  Keep that compatibility table
 * separate from TIMING_POINTS: aliases do not create a second emitted timing
 * point, and therefore do not change the v1.5 timing-point audit or replay
 * identity.
 */
export const TIMING_POINT_ALIASES = Object.freeze({
  "zone-entered": "object-enters-zone",
  "zone-left": "object-leaves-zone",
  "object-entered-zone": "object-enters-zone",
  "object-left-zone": "object-leaves-zone",
  "object-targeted": "became-target",
  "showdown-opened": "showdown-open",
  "showdown-closed": "showdown-close",
  "combat-ended": "combat-end",
  "chain-item-finalized": "chain-item-finalize",
  "chain-item-resolved": "chain-item-resolve",
  conquered: "conquer",
  held: "hold",
  scored: "score"
} as const satisfies Readonly<Record<string, TimingPointId>>);

export type TimingPointAlias = keyof typeof TIMING_POINT_ALIASES;
export type TimingPointReference = TimingPointId | TimingPointAlias;

export function isTimingPointAlias(value: unknown): value is TimingPointAlias {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TIMING_POINT_ALIASES, value);
}

/** Resolve an event/timing alias without changing the emitted timing id. */
export function resolveTimingPointId(value: string): TimingPointId | undefined {
  if (isTimingPointId(value)) return value;
  return isTimingPointAlias(value) ? TIMING_POINT_ALIASES[value] : undefined;
}

export interface TimingPointCoverage {
  readonly segment: string;
  readonly timingPointIds: readonly TimingPointId[];
  readonly ruleRefs: readonly string[];
  readonly ruleRefVersion: "1.5";
  readonly completeness: string;
}

const timingPointCoverage = [
  {
    segment: "回合与阶段流程",
    timingPointIds: [
      "turn-start", "awaken-start", "awaken-end", "beginning-start", "beginning-end",
      "channel-start", "channel-end", "draw-start", "draw-end", "main-start", "main-end",
      "turn-end"
    ],
    ruleRefs: ["314", "315", "316", "317.1"],
    ruleRefVersion: V15,
    completeness: "覆盖回合开始、Awaken、Beginning、Channel、Draw、Main 及结束步骤。"
  },
  {
    segment: "清理与胜负检查",
    timingPointIds: ["cleanup-start", "cleanup-end", "final-point"],
    ruleRefs: ["318", "323", "322", "334.2", "473.1.b", "474"],
    ruleRefVersion: V15,
    completeness: "覆盖任意清理与 Final Point 限制；清理并不总会结束回合。"
  },
  {
    segment: "区域与对象状态变化",
    timingPointIds: [
      "object-enters-zone", "object-leaves-zone", "object-enters-board", "object-leaves-board",
      "object-enters-battlefield", "object-leaves-battlefield", "object-enters-base", "object-leaves-base",
      "object-enters-deck", "object-leaves-deck", "object-enters-hand", "object-leaves-hand",
      "object-enters-rune-deck", "object-leaves-rune-deck", "object-enters-rune-zone", "object-leaves-rune-zone",
      "object-enters-trash", "object-leaves-trash", "object-enters-banishment", "object-leaves-banishment",
      "object-killed", "object-readied", "object-exhausted"
    ],
    ruleRefs: ["107", "108", "415", "416", "429", "383.2.c"],
    ruleRefVersion: V15,
    completeness: "覆盖原有区域与对象状态标识；rune-zone 表示基地中的符文区域。"
  },
  {
    segment: "打出、目标与链",
    timingPointIds: [
      "object-enters-chain", "object-leaves-chain", "card-played", "became-target",
      "chain-item-pending", "chain-item-finalize", "chain-item-resolve"
    ],
    ruleRefs: ["337", "340.1", "354", "355", "359", "383.3", "407"],
    ruleRefVersion: V15,
    completeness: "覆盖打出、成为目标及 Pending、Finalize、Resolve。"
  },
  {
    segment: "攻击、战斗与 Showdown",
    timingPointIds: [
      "attack-declared", "defense-declared", "showdown-open", "combat-damage-before",
      "combat-damage-after", "showdown-close", "combat-end", "combat-start", "combat-result"
    ],
    ruleRefs: ["347.2.a", "383.4.e", "383.4.f", "466.2", "467.2", "468.3", "468.7"],
    ruleRefVersion: V15,
    completeness: "覆盖身份取得、战斗开始、Showdown 开关、伤害前后、胜负判定与战斗结束。"
  },
  {
    segment: "控制、征服、固守与得分",
    timingPointIds: [
      "control-established", "control-lost", "conquer", "hold", "score",
      "contested-applied", "contested-removed", "points-gained"
    ],
    ruleRefs: ["190.3", "190.4", "468.5", "470", "471", "473"],
    ruleRefVersion: V15,
    completeness: "计分与点数区分；Contested 仅供内部流程，190.3.d 禁止卡牌引用。"
  },
  {
    segment: "游戏动作与派生状态",
    timingPointIds: [
      "object-moved", "card-drawn", "card-discarded", "damage-dealt", "unit-stunned", "xp-gained",
      "buff-added", "buff-spent", "empowered-changed", "card-recycled", "card-banished", "card-revealed",
      "objects-shown-off", "card-hidden", "card-burned", "cards-looked-at", "object-attached",
      "might-changed", "ability-activated"
    ],
    ruleRefs: ["383.2.c", "414", "417", "418", "421", "422", "423", "424", "425", "427", "428", "435", "441", "442", "443", "702.2.b", "709", "730.1", "832.1.c"],
    ruleRefVersion: V15,
    completeness: "只描述成功动作后的观察时点；同批次数、来源和目的地由载荷区分，替代前拦截属于 GameAction。"
  }
] as const satisfies readonly TimingPointCoverage[];

export const TIMING_POINT_COVERAGE = Object.freeze(timingPointCoverage);

export function isTimingPointId(value: unknown): value is TimingPointId {
  return typeof value === "string" && TIMING_POINT_IDS.includes(value as TimingPointId);
}

export function getTimingPoint(id: TimingPointId): TimingPointDefinition {
  const timingPoint = TIMING_POINTS.find(point => point.id === id);
  if (!timingPoint) throw new Error(`Unknown timing point ${id}`);
  return timingPoint;
}
