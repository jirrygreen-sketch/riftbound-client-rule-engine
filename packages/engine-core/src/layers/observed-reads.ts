/**
 * RIFT-1163: a completed command plan survives events and timing-point changes
 * only when its pass made no read that can depend on them (timing point, event
 * history, player state, last-known information). Such reads report here while
 * any layer engine is evaluating; every engine on the stack is marked, so a
 * read inside a nested engine also marks its caller. A function condition can
 * read anything, so only conditions whose every non-object read goes through a
 * recorded ResolveContext may be marked observed; any other one marks the pass.
 */
export interface EventSensitiveReader {
  markEventSensitiveRead(): void;
}

const EVALUATING: EventSensitiveReader[] = [];
const OBSERVED_CONDITIONS = new WeakSet<object>();

export function markObservedCondition<T extends object>(condition: T): T {
  OBSERVED_CONDITIONS.add(condition);
  return condition;
}

export function isObservedCondition(condition: object): boolean {
  return OBSERVED_CONDITIONS.has(condition);
}

export function layerEvaluationActive(): boolean {
  return EVALUATING.length > 0;
}

export function noteEventSensitiveRead(): void {
  for (const engine of EVALUATING) engine.markEventSensitiveRead();
}

export function enterLayerEvaluation(engine: EventSensitiveReader): void {
  EVALUATING.push(engine);
}

export function leaveLayerEvaluation(engine: EventSensitiveReader): void {
  EVALUATING.splice(EVALUATING.lastIndexOf(engine), 1);
}
