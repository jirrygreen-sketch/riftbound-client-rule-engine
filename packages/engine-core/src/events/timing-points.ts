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
  | "final-point";

export interface TimingPointDefinition {
  readonly id: TimingPointId;
  readonly descriptionZh: string;
  readonly emittedBy: TimingPointEmitter;
  readonly payloadType: TimingPointPayloadType;
  readonly ruleRefs: readonly string[];
  readonly ruleRefVersion: "1.4" | "1.5";
}

type TimingPointDefinitionInput = Omit<TimingPointDefinition, "id"> & {
  readonly id: string;
};

const V14 = "1.4" as const;

const timingPoints = [
  {
    id: "turn-start",
    descriptionZh: "新回合开始，回合流程准备进入 Awaken 阶段。",
    emittedBy: "turn",
    payloadType: "turn",
    ruleRefs: ["315.1"],
    ruleRefVersion: V14
  },
  {
    id: "awaken-start",
    descriptionZh: "Awaken 阶段开始，执行本阶段开始时的流程与触发。",
    emittedBy: "turn",
    payloadType: "phase",
    ruleRefs: ["315.1"],
    ruleRefVersion: V14
  },
  {
    id: "awaken-end",
    descriptionZh: "Awaken 阶段完成并离开该阶段。",
    emittedBy: "turn",
    payloadType: "phase",
    ruleRefs: ["315.1"],
    ruleRefVersion: V14
  },
  {
    id: "beginning-start",
    descriptionZh: "Beginning 阶段开始，执行该阶段的开始步骤。",
    emittedBy: "turn",
    payloadType: "phase",
    ruleRefs: ["315.2"],
    ruleRefVersion: V14
  },
  {
    id: "beginning-end",
    descriptionZh: "Beginning 阶段完成并离开该阶段。",
    emittedBy: "turn",
    payloadType: "phase",
    ruleRefs: ["315.2"],
    ruleRefVersion: V14
  },
  {
    id: "channel-start",
    descriptionZh: "Channel 阶段开始，执行该阶段的资源流程。",
    emittedBy: "turn",
    payloadType: "phase",
    ruleRefs: ["315.3"],
    ruleRefVersion: V14
  },
  {
    id: "channel-end",
    descriptionZh: "Channel 阶段完成并离开该阶段。",
    emittedBy: "turn",
    payloadType: "phase",
    ruleRefs: ["315.3"],
    ruleRefVersion: V14
  },
  {
    id: "draw-start",
    descriptionZh: "Draw 阶段开始并进入抽牌流程。",
    emittedBy: "turn",
    payloadType: "phase",
    ruleRefs: ["315.4"],
    ruleRefVersion: V14
  },
  {
    id: "draw-end",
    descriptionZh: "Draw 阶段完成并离开该阶段。",
    emittedBy: "turn",
    payloadType: "phase",
    ruleRefs: ["315.4"],
    ruleRefVersion: V14
  },
  {
    id: "main-start",
    descriptionZh: "Main 阶段开始，开放本阶段的行动流程。",
    emittedBy: "turn",
    payloadType: "phase",
    ruleRefs: ["316.1", "316.4"],
    ruleRefVersion: V14
  },
  {
    id: "main-end",
    descriptionZh: "Main 阶段完成并离开该阶段。",
    emittedBy: "turn",
    payloadType: "phase",
    ruleRefs: ["316.1", "316.4"],
    ruleRefVersion: V14
  },
  {
    id: "turn-end",
    descriptionZh: "本回合的流程到达结束时点，随后进入清理。",
    emittedBy: "turn",
    payloadType: "turn",
    ruleRefs: ["317.1", "317.2"],
    ruleRefVersion: V14
  },
  {
    id: "cleanup-start",
    descriptionZh: "清理开始，执行回合结束后的状态检查与清理步骤。",
    emittedBy: "turn",
    payloadType: "cleanup",
    ruleRefs: ["323.1", "323.2"],
    ruleRefVersion: V14
  },
  {
    id: "cleanup-end",
    descriptionZh: "清理完成，完成胜负检查并准备下一回合。",
    emittedBy: "turn",
    payloadType: "cleanup",
    ruleRefs: ["323.1", "323.2", "472"],
    ruleRefVersion: V14
  },
  {
    id: "object-enters-zone",
    descriptionZh: "游戏对象进入一个区域。具体区域由事件载荷携带。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["141.1", "146.1", "151.1"],
    ruleRefVersion: V14
  },
  {
    id: "object-leaves-zone",
    descriptionZh: "游戏对象离开一个区域。具体区域由事件载荷携带。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["141.1", "146.1", "151.1"],
    ruleRefVersion: V14
  },
  {
    id: "object-enters-board",
    descriptionZh: "游戏对象进入 Board。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["141.1", "143.4"],
    ruleRefVersion: V14
  },
  {
    id: "object-leaves-board",
    descriptionZh: "游戏对象离开 Board。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["141.1", "146.1"],
    ruleRefVersion: V14
  },
  {
    id: "object-enters-battlefield",
    descriptionZh: "游戏对象进入一个 Battlefield。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["107.2", "141.1", "146.1"],
    ruleRefVersion: V14
  },
  {
    id: "object-leaves-battlefield",
    descriptionZh: "游戏对象离开一个 Battlefield。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["107.2", "141.1", "146.1"],
    ruleRefVersion: V14
  },
  {
    id: "object-enters-base",
    descriptionZh: "游戏对象进入一个 Base。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["107.1", "141.1", "146.1"],
    ruleRefVersion: V14
  },
  {
    id: "object-leaves-base",
    descriptionZh: "游戏对象离开一个 Base。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["107.1", "141.1", "146.1"],
    ruleRefVersion: V14
  },
  {
    id: "object-enters-deck",
    descriptionZh: "游戏对象进入牌库。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["151.1"],
    ruleRefVersion: V14
  },
  {
    id: "object-leaves-deck",
    descriptionZh: "游戏对象离开牌库。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["151.1"],
    ruleRefVersion: V14
  },
  {
    id: "object-enters-hand",
    descriptionZh: "游戏对象进入手牌。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["151.1"],
    ruleRefVersion: V14
  },
  {
    id: "object-leaves-hand",
    descriptionZh: "游戏对象离开手牌。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["151.1"],
    ruleRefVersion: V14
  },
  {
    id: "object-enters-rune-deck",
    descriptionZh: "游戏对象进入符文牌库。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["151.1"],
    ruleRefVersion: V14
  },
  {
    id: "object-leaves-rune-deck",
    descriptionZh: "游戏对象离开符文牌库。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["151.1"],
    ruleRefVersion: V14
  },
  {
    id: "object-enters-rune-zone",
    descriptionZh: "符文对象进入符文区。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["107.1", "151.1"],
    ruleRefVersion: V14
  },
  {
    id: "object-leaves-rune-zone",
    descriptionZh: "符文对象离开符文区。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["107.1", "151.1"],
    ruleRefVersion: V14
  },
  {
    id: "object-enters-trash",
    descriptionZh: "游戏对象进入 Trash。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["151.1", "808.1.d"],
    ruleRefVersion: V14
  },
  {
    id: "object-leaves-trash",
    descriptionZh: "游戏对象离开 Trash。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["151.1"],
    ruleRefVersion: V14
  },
  {
    id: "object-enters-banishment",
    descriptionZh: "游戏对象进入 Banishment。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["151.1"],
    ruleRefVersion: V14
  },
  {
    id: "object-leaves-banishment",
    descriptionZh: "游戏对象离开 Banishment。",
    emittedBy: "events",
    payloadType: "zone-change",
    ruleRefs: ["151.1"],
    ruleRefVersion: V14
  },
  {
    id: "object-enters-chain",
    descriptionZh: "游戏对象进入 Chain。",
    emittedBy: "chain",
    payloadType: "zone-change",
    ruleRefs: ["337.2", "354"],
    ruleRefVersion: V14
  },
  {
    id: "object-leaves-chain",
    descriptionZh: "游戏对象离开 Chain。",
    emittedBy: "chain",
    payloadType: "zone-change",
    ruleRefs: ["337.2", "358.1"],
    ruleRefVersion: V14
  },
  {
    id: "card-played",
    descriptionZh: "一张牌成功完成打出并产生打出事件。",
    emittedBy: "events",
    payloadType: "card-play",
    ruleRefs: ["337.2", "354", "358.1"],
    ruleRefVersion: V14
  },
  {
    id: "became-target",
    descriptionZh: "一个对象在选择目标时成为目标。",
    emittedBy: "events",
    payloadType: "targeting",
    ruleRefs: ["355", "377.1"],
    ruleRefVersion: V14
  },
  {
    id: "object-killed",
    descriptionZh: "一个对象被消灭，产生消灭后的触发时点。",
    emittedBy: "events",
    payloadType: "object",
    ruleRefs: ["808.1.d"],
    ruleRefVersion: V14
  },
  {
    id: "object-readied",
    descriptionZh: "一个对象变为 Ready。",
    emittedBy: "events",
    payloadType: "object",
    ruleRefs: ["143.4", "149.1"],
    ruleRefVersion: V14
  },
  {
    id: "object-exhausted",
    descriptionZh: "一个对象变为 Exhausted。",
    emittedBy: "events",
    payloadType: "object",
    ruleRefs: ["143.4", "149.1"],
    ruleRefVersion: V14
  },
  {
    id: "attack-declared",
    descriptionZh: "攻击者宣告攻击，进入攻击相关流程。",
    emittedBy: "combat",
    payloadType: "attack",
    ruleRefs: ["346", "464.2"],
    ruleRefVersion: V14
  },
  {
    id: "defense-declared",
    descriptionZh: "防御者宣告防御，进入防御相关流程。",
    emittedBy: "combat",
    payloadType: "defense",
    ruleRefs: ["346", "464.2"],
    ruleRefVersion: V14
  },
  {
    id: "showdown-open",
    descriptionZh: "Showdown 开启，进入 Showdown Open 状态。",
    emittedBy: "combat",
    payloadType: "showdown",
    ruleRefs: ["316.8", "464.2.d"],
    ruleRefVersion: V14
  },
  {
    id: "combat-damage-before",
    descriptionZh: "战斗伤害分配完成、实际造成伤害之前。",
    emittedBy: "combat",
    payloadType: "combat-damage",
    ruleRefs: ["465.2"],
    ruleRefVersion: V14
  },
  {
    id: "combat-damage-after",
    descriptionZh: "战斗伤害实际同时造成之后。",
    emittedBy: "combat",
    payloadType: "combat-damage",
    ruleRefs: ["465.2", "466.5"],
    ruleRefVersion: V14
  },
  {
    id: "showdown-close",
    descriptionZh: "Showdown 关闭并完成该次 Showdown 的收束流程。",
    emittedBy: "combat",
    payloadType: "showdown",
    ruleRefs: ["316.8", "466.5"],
    ruleRefVersion: V14
  },
  {
    id: "combat-end",
    descriptionZh: "一次 Combat 流程完成。",
    emittedBy: "combat",
    payloadType: "combat",
    ruleRefs: ["466.5"],
    ruleRefVersion: V14
  },
  {
    id: "chain-item-pending",
    descriptionZh: "链项进入 Pending，等待 HOT FEPR 处理。",
    emittedBy: "chain",
    payloadType: "chain-item",
    ruleRefs: ["303.2", "337.2"],
    ruleRefVersion: V14
  },
  {
    id: "chain-item-finalize",
    descriptionZh: "链项进入 Finalize，检查费用、要求、限制与目标。",
    emittedBy: "chain",
    payloadType: "chain-item",
    ruleRefs: ["303.2", "356", "357"],
    ruleRefVersion: V14
  },
  {
    id: "chain-item-resolve",
    descriptionZh: "链项进入 Resolve，按顺序执行其能力。",
    emittedBy: "chain",
    payloadType: "chain-item",
    ruleRefs: ["303.2", "337.2", "358.1"],
    ruleRefVersion: V14
  },
  {
    id: "control-established",
    descriptionZh: "一个 Battlefield 建立或重新建立控制。",
    emittedBy: "scoring",
    payloadType: "control",
    ruleRefs: ["190.4", "466.5"],
    ruleRefVersion: V14
  },
  {
    id: "control-lost",
    descriptionZh: "一个 Battlefield 失去控制。",
    emittedBy: "scoring",
    payloadType: "control",
    ruleRefs: ["190.3", "190.4"],
    ruleRefVersion: V14
  },
  {
    id: "conquer",
    descriptionZh: "一个 Battlefield 发生 Conquer。",
    emittedBy: "scoring",
    payloadType: "scoring",
    ruleRefs: ["466.5", "469.1"],
    ruleRefVersion: V14
  },
  {
    id: "hold",
    descriptionZh: "回合玩家在 Beginning 的计分步骤中固守 Battlefield。",
    emittedBy: "scoring",
    payloadType: "scoring",
    ruleRefs: ["315.2.b", "469.2"],
    ruleRefVersion: V14
  },
  {
    id: "score",
    descriptionZh: "一次 Conquer 或 Hold 产生得分。",
    emittedBy: "scoring",
    payloadType: "scoring",
    ruleRefs: ["468", "469.1", "469.2", "471.2"],
    ruleRefVersion: V14
  },
  {
    id: "final-point",
    descriptionZh: "得分动作满足 Final Point 检查所需的时点。",
    emittedBy: "scoring",
    payloadType: "final-point",
    ruleRefs: ["471.1", "472"],
    ruleRefVersion: V14
  }
] as const satisfies readonly TimingPointDefinitionInput[];

export type TimingPointId = (typeof timingPoints)[number]["id"];

export const TIMING_POINTS = Object.freeze(timingPoints) as readonly TimingPointDefinition[];

export const TIMING_POINT_IDS = Object.freeze(
  TIMING_POINTS.map(point => point.id)
) as readonly TimingPointId[];

export interface TimingPointCoverage {
  readonly segment: string;
  readonly timingPointIds: readonly TimingPointId[];
  readonly ruleRefs: readonly string[];
  readonly ruleRefVersion: "1.4" | "1.5";
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
    ruleRefs: ["315.1", "315.2", "315.3", "315.4", "316.1", "316.4", "317.1", "317.2"],
    ruleRefVersion: V14,
    completeness: "覆盖回合开始、Awaken、Beginning、Channel、Draw、Main 及本回合结束。"
  },
  {
    segment: "清理与胜负检查",
    timingPointIds: ["cleanup-start", "cleanup-end", "final-point"],
    ruleRefs: ["323.1", "323.2", "194.2", "194.3", "471.1", "472"],
    ruleRefVersion: V14,
    completeness: "覆盖清理固定点、胜负检查与 Final Point 限制。"
  },
  {
    segment: "区域与对象状态变化",
    timingPointIds: [
      "object-enters-zone", "object-leaves-zone", "object-enters-board", "object-leaves-board",
      "object-enters-battlefield", "object-leaves-battlefield", "object-enters-base", "object-leaves-base",
      "object-enters-deck", "object-leaves-deck", "object-enters-hand", "object-leaves-hand",
      "object-enters-rune-deck", "object-leaves-rune-deck", "object-enters-rune-zone", "object-leaves-rune-zone",
      "object-enters-trash", "object-leaves-trash", "object-enters-banishment", "object-leaves-banishment",
      "object-enters-chain", "object-leaves-chain", "object-killed", "object-readied", "object-exhausted"
    ],
    ruleRefs: ["107.1", "107.2", "141.1", "143.4", "146.1", "149.1", "151.1", "808.1.d"],
    ruleRefVersion: V14,
    completeness: "覆盖 Board、Base、Battlefield、牌库、手牌、符文区、Trash、Banishment、Chain 及对象状态改变。"
  },
  {
    segment: "打出、目标与链",
    timingPointIds: [
      "card-played", "became-target", "chain-item-pending", "chain-item-finalize", "chain-item-resolve"
    ],
    ruleRefs: ["303.2", "337.2", "354", "355", "356", "357", "358.1", "377.1"],
    ruleRefVersion: V14,
    completeness: "覆盖打出、成为目标以及 Pending、Finalize、Resolve 三个链项时点。"
  },
  {
    segment: "攻击、战斗与 Showdown",
    timingPointIds: [
      "attack-declared", "defense-declared", "showdown-open", "combat-damage-before",
      "combat-damage-after", "showdown-close", "combat-end"
    ],
    ruleRefs: ["316.8", "346", "464.2.d", "465.2", "466.5"],
    ruleRefVersion: V14,
    completeness: "覆盖攻击/防御宣告、Showdown 开关、战斗伤害前后与 Combat 结束。"
  },
  {
    segment: "控制、征服、固守与得分",
    timingPointIds: ["control-established", "control-lost", "conquer", "hold", "score"],
    ruleRefs: ["190.3", "190.4", "315.2.b", "466.5", "468", "469.1", "469.2", "471.2"],
    ruleRefVersion: V14,
    completeness: "覆盖 Contested/Control 的变化、Conquer、Hold、Score 及其触发。"
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
