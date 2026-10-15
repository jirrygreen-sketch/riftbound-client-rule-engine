/** Finite source-qualified engagement services. Unknown programs and live
 * modifiers remain pending; a catalog number alone cannot prove current Might. */
import {
  inspectDuelPhaseSourcesV2, gainDuelPoints,
  type DuelCanonicalPlayingStateV2, type DuelEngagementServicesV2,
  type DuelPhaseSourceClosureContextV2,
} from '@riftbound/engine-core/duel';
import type { DuelProductionSourceServicesV2 } from './production-source-services-v2.js';

export function createDuelEngagementServicesV2(options: {
  readonly currentHead: () => DuelCanonicalPlayingStateV2 | null;
  readonly sources: DuelProductionSourceServicesV2;
  readonly randomIndex: (upperBound: number) => number;
}): DuelEngagementServicesV2 {
  const head = () => {
    const value = options.currentHead();
    if (!value) throw new TypeError('missing current playing head');
    return value;
  };
  const context = (match: DuelCanonicalPlayingStateV2, taskId: string,
    event: 'required-cleanup' | 'fepr' | 'lethal-kill' | 'burnout' = 'required-cleanup', continuous = false): DuelPhaseSourceClosureContextV2 => ({
    matchId: match.matchId, dataVersion: match.dataVersion, catalogDigest: match.catalogDigest,
    turn: match.frame.turnNumber, taskId, phase: event, event: continuous ? 'continuous' : event,
    clock: { stateVersion: match.stateVersion, eventSeq: match.eventSeq },
  });
  const clear = (match: DuelCanonicalPlayingStateV2, taskId: string,
    event: 'required-cleanup' | 'fepr' | 'lethal-kill' | 'burnout' = 'required-cleanup') => {
    if (head() !== match) return false;
    const inspected = options.sources.inspect(context(match, taskId, event));
    return inspected.status === 'ready' && inspected.handlers.length === 0 &&
      inspected.activeSources.length === 0 && head() === match;
  };
  const might = (uid: string) => {
    const match = head(), taskId = `duel-v2:${match.matchId}:turn-${match.frame.turnNumber}:engagement-might:${uid}`;
    const value = options.sources.derivedMight(uid, context(match, taskId, 'required-cleanup', true));
    if (value.status !== 'complete' || typeof value.currentMight !== 'number' || head() !== match)
      throw new TypeError('unresolved current Might');
    return value.currentMight;
  };
  const drawProof = (request: Parameters<NonNullable<DuelEngagementServicesV2['sourceDraw']>>[0]) => ({
    status: 'ready' as const, matchId: request.match.matchId,
    stateVersion: request.match.stateVersion, eventSeq: request.match.eventSeq,
    fieldId: request.fieldId, taskId: request.taskId, scorePlayerId: request.score.playerId,
  });
  const services: DuelEngagementServicesV2 = {
    readHead: head, sources: options.sources.phaseRegistry, randomIndex: options.randomIndex,
    inspectEffects: request => {
      const event = request.boundary === 'deathknell' ? 'lethal-kill' : request.boundary === 'fepr' ? 'fepr' : 'required-cleanup';
      if (!clear(request.match, request.taskId, event)) return { status: 'pending' as const };
      const inspected = inspectDuelPhaseSourcesV2(request.match, event, request.match.frame.turnNumber,
        request.taskId, options.sources.phaseRegistry);
      if (inspected.status !== 'ready' || inspected.handlers.length ||
          JSON.stringify(inspected.sources.map(source => source.uid)) !== JSON.stringify(request.sourceUIDs))
        return { status: 'pending' as const };
      return { status: 'none' as const, matchId: request.match.matchId,
        stateVersion: request.match.stateVersion, eventSeq: request.match.eventSeq,
        boundary: request.boundary, taskId: request.taskId, sourceUIDs: request.sourceUIDs };
    },
    combat: {
      proveBasicCombat: request => {
        const match = head(), taskId = `duel-v2:${match.matchId}:turn-${match.frame.turnNumber}:combat:${request.fieldId}`;
        if (request.stateVersion !== match.stateVersion || !clear(match, taskId) ||
            request.unitUIDs.some(uid => !match.board.units.some(unit => unit.objectId === uid))) return null;
        return { currentMight: 'validated' as const, assignmentModifier: 'proven-none' as const,
          preventionReplacement: 'proven-none' as const, keywordPriority: 'proven-none' as const };
      },
      currentMight: unit => might(unit.uid),
    },
    lethalEvaluators: { currentMight: unit => might(unit.objectId), lethalDamageThreshold: (_unit, currentMight) => currentMight },
    approveLethal: (plan, match) => {
      const taskId = `duel-v2:${match.matchId}:turn-${match.frame.turnNumber}:engagement-kill:${match.stateVersion}`;
      if (plan.stateVersion !== match.stateVersion || !clear(match, taskId, 'lethal-kill'))
        return { status: 'pending' as const };
      return { status: 'approved' as const, approvedUnitUIDs: plan.snapshots.map(unit => unit.objectId),
        preExitSettled: true as const, deathknellSettled: true as const };
    },
    fepr: (match, taskId) => ({ status: clear(match, taskId, 'fepr') ? 'none' as const : 'pending' as const }),
    sourceDraw: request => clear(request.match, request.taskId) ? drawProof(request) : { status: 'pending' as const },
    firstBurnout: request => {
      if (!clear(request.match, request.taskId, 'burnout')) return { status: 'pending' as const };
      const opponent = request.match.turnOrder.find(player => player !== request.score.playerId)!;
      return { ...drawProof(request), firstBurnoutResolution: { kind: 'scored' as const,
        scoring: gainDuelPoints(request.match.scoring, request.match.board, opponent, 1).state } };
    },
    intervention: request => clear(request.match, request.taskId, 'burnout') ? drawProof(request) : { status: 'pending' as const },
  };
  return Object.freeze(services);
}
