import { type GameEvent } from "@riftbound/protocol";

export function mergeEvents(
  left: readonly GameEvent[],
  right: readonly GameEvent[]
): readonly GameEvent[] {
  const bySeq = new Map(left.map(event => [event.seq, event]));
  for (const event of right) bySeq.set(event.seq, event);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}
