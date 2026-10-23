import type {
  V2EngineEvent,
  V2ProjectedObject,
  V2Projection,
  V2Zone
} from "../../../../packages/protocol/src/v2/index.js";
import "./ReplayPage.css";

/** A read-only projection of the stored protocol-v2 frame. */
export function V2ReplayViewer({
  projection
}: {
  readonly projection: V2Projection;
}) {
  const viewer = projection.players.find(player => player.playerId === projection.viewerPlayerId) ?? null;
  const opponent = projection.players.find(player => player.playerId !== projection.viewerPlayerId) ?? null;
  const ownHand = projection.zones.find(zone => zone.zone === "hand" &&
    zone.ownerPlayerId === projection.viewerPlayerId)?.objects ?? [];
  const events = uniqueEvents(projection.events);
  return (
    <section className="replay-v2-frame" aria-label="协议 v2 回放牌桌">
      <header className="replay-v2-header">
        <div>
          <p className="replay-v2-kicker">协议 v2 · {projection.rulesetVersion}</p>
          <h3>{phaseLabel(projection)} · 第 {projection.turnNumber} 回合</h3>
        </div>
        <dl className="replay-v2-clock">
          <div><dt>状态</dt><dd>{projection.stateVersion}</dd></div>
          <div><dt>事件</dt><dd>{projection.eventSeq}</dd></div>
          <div><dt>视角</dt><dd>{viewer?.name ?? projection.viewerPlayerId ?? "—"}</dd></div>
        </dl>
      </header>
      {projection.winnerPlayerId === null ? null : (
        <p className="replay-v2-winner" role="status">
          胜者：{projection.players.find(player => player.playerId === projection.winnerPlayerId)?.name ?? projection.winnerPlayerId}
        </p>
      )}
      <div className="replay-v2-players">
        {projection.players.map(player => (
          <article key={player.playerId} className="replay-v2-player">
            <h4>{player.name}{player.playerId === projection.activePlayerId ? " · 行动玩家" : ""}</h4>
            <dl>
              <div><dt>比分</dt><dd>{player.score}</dd></div>
              <div><dt>能量</dt><dd>{player.energy}</dd></div>
              <div><dt>经验</dt><dd>{player.xp}</dd></div>
              <div><dt>手牌</dt><dd>{player.handCount}</dd></div>
              <div><dt>牌库</dt><dd>{player.deckCount}</dd></div>
              <div><dt>符文库</dt><dd>{player.runeDeckCount}</dd></div>
            </dl>
          </article>
        ))}
      </div>
      <div className="replay-v2-zones">
        <Zone title="我的手牌" objects={ownHand} empty="手牌为空" />
        <Zone title="对手手牌" count={opponent?.handCount ?? 0} hidden empty="手牌隐藏" />
        {visibleObjects(projection, "base").map(group => (
          <Zone key={`base:${group.ownerPlayerId}`} title={`${nameFor(projection, group.ownerPlayerId)} 基地`}
            objects={group.objects} empty="暂无公开牌" />
        ))}
        <Zone title="战场" objects={visibleObjects(projection, "battlefield").flatMap(group => group.objects)}
          empty="暂无公开牌" />
        <Zone title="符文区" objects={visibleObjects(projection, "rune-zone").flatMap(group => group.objects)}
          empty="暂无公开牌" />
      </div>
      <section className="replay-v2-status" aria-label="链与优先权">
        <h4>链 / 优先权</h4>
        <p>链状态：{projection.chain.status} · 阶段：{projection.chain.phase} · 窗口：{projection.priority.window}</p>
        <p>优先权：{nameFor(projection, projection.priority.playerId)} · Focus：{nameFor(projection, projection.priority.focusPlayerId)}</p>
        {projection.chain.items.length === 0 ? <p>链为空</p> : (
          <ol>{projection.chain.items.map(item => (
            <li key={item.itemId}>{item.kind} · {item.status} · {nameFor(projection, item.controllerPlayerId)}</li>
          ))}</ol>
        )}
      </section>
      <section className="replay-v2-events" aria-label="回放事件">
        <h4>对局事件</h4>
        {events.length === 0 ? <p>暂无事件</p> : (
          <ol>{events.map(event => <li key={event.eventSeq}>#{event.eventSeq} · {event.timingPoint}</li>)}</ol>
        )}
      </section>
      <p className="replay-v2-readonly" role="note">V2 回放只读：存储在本地，翻帧不会发送任何对局指令。</p>
    </section>
  );
}

function Zone({
  title,
  objects = [],
  count = objects.length,
  hidden = false,
  empty
}: {
  readonly title: string;
  readonly objects?: readonly V2ProjectedObject[];
  readonly count?: number;
  readonly hidden?: boolean;
  readonly empty: string;
}) {
  return (
    <section className="replay-v2-zone" aria-label={title}>
      <h4>{title}<span>{count}</span></h4>
      {hidden ? <p>隐藏信息</p> : objects.length === 0 ? <p>{empty}</p> : (
        <ul>{objects.map(object => (
          <li key={object.objectId}>{object.name ?? object.cardId ?? "未知卡牌"}
            {object.damage === undefined || object.damage === 0 ? null : ` · 伤害 ${object.damage}`}
            {object.might === undefined ? null : ` · 战力 ${object.might}`}</li>
        ))}</ul>
      )}
    </section>
  );
}

function visibleObjects(projection: V2Projection, zone: V2Zone): readonly {
  readonly ownerPlayerId: string;
  readonly objects: readonly V2ProjectedObject[];
}[] {
  return projection.players.flatMap(player => {
    const source = projection.zones.find(snapshot => snapshot.zone === zone &&
      snapshot.ownerPlayerId === player.playerId);
    const objects = source?.objects ?? projection.objects.filter(object =>
      object.zone === zone && object.ownerPlayerId === player.playerId);
    return objects.length === 0 ? [] : [{ ownerPlayerId: player.playerId, objects }];
  });
}

function uniqueEvents(events: readonly V2EngineEvent[]): readonly V2EngineEvent[] {
  const bySeq = new Map<number, V2EngineEvent>();
  for (const event of events) bySeq.set(event.eventSeq, event);
  return [...bySeq.values()].sort((left, right) => left.eventSeq - right.eventSeq);
}

function nameFor(projection: V2Projection, playerId: string | null): string {
  if (playerId === null) return "无";
  return projection.players.find(player => player.playerId === playerId)?.name ?? playerId;
}

function phaseLabel(projection: V2Projection): string {
  const labels: Readonly<Record<V2Projection["phase"], string>> = {
    setup: "准备阶段", awaken: "觉醒", beginning: "开始", channel: "频道",
    draw: "抽牌", main: "主阶段", combat: "战斗", ending: "结束",
    expiration: "到期", ended: "对局结束"
  };
  return labels[projection.phase];
}
