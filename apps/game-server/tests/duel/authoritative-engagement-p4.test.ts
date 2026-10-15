import { describe, expect, it } from 'vitest';
import { loadCardCatalogRuntime } from '../../src/card-catalog.js';
import { createAuthoritativeDuelRuntimeP4 } from '../../src/duel/authoritative-runtime-p4.js';
import { setupAdapterFixtureCatalog, setupAdapterFixtureDecks } from './fixtures/setup-adapter-catalog.js';
import { DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1, isDuelProjectionV3Actions1,
  type DuelWireCommandV3Actions1 } from '@riftbound/protocol';

async function fixture() {
  // The controlled programs and prices here are test inputs, not official printing data.
  const cards = setupAdapterFixtureCatalog.cards.map(card => ({ ...card,
    ...(card.cardType === 'Unit' ? { energy: 1, power: null } : {}),
    ability: card.cardType === 'Unit' ? '' : card.cardType === 'Spell' ? 'Draw 4.' :
      card.cardType === 'Legend' ? ':rb_energy_1:, :rb_exhaust:: Play a 1 :rb_might: Recruit unit token.' :
        card.cardType === 'Battlefield' ? 'You may hide an additional card here.' : card.ability }));
  const catalog = await loadCardCatalogRuntime({ catalog: { ...setupAdapterFixtureCatalog, cards,
    dataVersion: '2026-10-12-official-gallery',
    digest: 'sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10' } });
  let uid = 0, command = 0;
  const runtime = createAuthoritativeDuelRuntimeP4({ catalog, matchId: 'p4-engagement-controlled-fixture',
    roster: [{ playerId: 'alice', displayName: 'Alice', deck: setupAdapterFixtureDecks.a.submission },
      { playerId: 'bob', displayName: 'Bob', deck: setupAdapterFixtureDecks.b.submission }],
    randomIndex: () => 0, uidFactory: () => `engagement-fixture-${++uid}` });
  const send = (actor: string, body: DuelWireCommandV3Actions1) => {
    const projection = runtime.project(actor);
    const packet = { type: 'duel-command' as const, commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
      requestId: `request-${++command}`, commandId: `command-${command}`, expectedVersion: projection.match.stateVersion, command: body };
    return { packet, result: runtime.dispatch(actor, packet) };
  };
  for (let n = 0; n < 2; n++) {
    const p = runtime.project(null);
    if (p.match.stage !== 'setup') throw Error('setup expected');
    expect(send(p.match.setup.currentMulliganOwner!, { type: 'mulligan', selectedUIDs: [] }).result.ack.ok).toBe(true);
  }
  const end = (actor: string) => {
    const action = runtime.project(actor).actions.find(action => action.kind === 'end-turn');
    if (!action || action.kind !== 'end-turn' || !action.enabled) throw Error('End action required');
    const result = send(actor, { type: 'end-turn', windowId: action.windowId }).result;
    expect(result.ack, JSON.stringify(result.ack)).toMatchObject({ ok: true });
  };
  const play = (actor: string) => {
    const rune = runtime.project(actor).actions.find(action => action.kind === 'rune-energy' && action.enabled);
    if (!rune || rune.kind !== 'rune-energy') throw Error('Rune Energy required');
    expect(send(actor, { type: 'rune-energy', uid: rune.uid }).result.ack.ok).toBe(true);
    const card = runtime.project(actor).actions.find(action => action.kind === 'play-card' && action.enabled);
    if (!card || card.kind !== 'play-card') throw Error('Unit Play required');
    expect(send(actor, { type: 'play-card', cardUID: card.cardUID, windowId: card.windowId }).result.ack.ok).toBe(true);
    return card.cardUID;
  };
  return { runtime, send, end, play };
}

describe('P4 native engagement composition', () => {
  it('runs a real paid Unit, next-turn awaken, Move, two Focus passes and Conquer without editing Main', async () => {
    const f = await fixture();
    const uid = f.play('alice');
    f.end('alice'); f.end('bob');
    const before = f.runtime.project('alice');
    if (before.match.stage !== 'playing') throw Error('playing required');
    const move = before.actions.find(action => action.kind === 'standard-move');
    if (!move || move.kind !== 'standard-move') throw Error('Move action required');
    expect(move.enabled).toBe(true);
    const field = before.match.board.battlefields[0]!;
    const movement = f.send('alice', { type: 'standard-move', unitUIDs: [uid],
      destinationLocationId: field.locationId, windowId: move.windowId });
    expect(movement.result.ack, JSON.stringify(movement.result.ack)).toMatchObject({ ok: true });
    const after = f.runtime.project('alice');
    if (after.match.stage !== 'playing') throw Error('playing required');
    expect(after.match.board.units.find(unit => unit.objectId === uid)?.locationId).toBe(field.locationId);
    expect(after.match.frame.focusPlayerId).toBe('alice');
    expect(f.runtime.dispatch('alice', movement.packet).ack.duplicate).toBe(true);
    expect(f.runtime.project('alice').match).toEqual(after.match);
    for (const actor of ['alice', 'bob']) {
      const pass = f.runtime.project(actor).actions.find(action => action.kind === 'pass-focus');
      if (!pass || pass.kind !== 'pass-focus') throw Error(`Focus action required for ${actor}`);
      expect(f.send(actor, { type: 'pass-focus', windowId: pass.windowId }).result.ack.ok).toBe(true);
    }
    const settled = f.runtime.project('alice');
    if (settled.match.stage !== 'playing') throw Error('playing required');
    expect(settled.match.frame.execution.status).toBe('ready');
    expect(settled.match.frame.focusPlayerId).toBeNull();
    expect(settled.match.board.battlefields[0]!.controllerPlayerId).toBe('alice');
    expect(settled.match.scoring.players.find(player => player.playerId === 'alice')?.points).toBe(1);
    expect(isDuelProjectionV3Actions1(settled)).toBe(true);
  }, 30_000);

  it('binds each combat allocation to its actor and current choice before dealing and cleaning up once', async () => {
    const f = await fixture(), a = f.play('alice');
    f.end('alice');
    const b = f.play('bob'); f.end('bob');
    let fieldId = '';
    const move = (actor: string, uid: string) => {
      const projection = f.runtime.project(actor);
      if (projection.match.stage !== 'playing') throw Error('playing required');
      fieldId ||= projection.match.board.battlefields[0]!.locationId;
      const action = projection.actions.find(value => value.kind === 'standard-move' && value.enabled);
      if (!action || action.kind !== 'standard-move') throw Error('Move required');
      expect(f.send(actor, { type: 'standard-move', unitUIDs: [uid], destinationLocationId: fieldId,
        windowId: action.windowId }).result.ack).toMatchObject({ ok: true });
      for (const focusOwner of [actor, actor === 'alice' ? 'bob' : 'alice']) {
        const pass = f.runtime.project(focusOwner).actions.find(value => value.kind === 'pass-focus');
        if (!pass || pass.kind !== 'pass-focus') throw Error('Focus required');
        expect(f.send(focusOwner, { type: 'pass-focus', windowId: pass.windowId }).result.ack).toMatchObject({ ok: true });
      }
    };
    move('alice', a); f.end('alice'); move('bob', b);
    for (const actor of ['bob', 'alice']) {
      const p = f.runtime.project(actor), other = f.runtime.project(actor === 'alice' ? 'bob' : 'alice');
      if (p.match.stage !== 'playing' || other.match.stage !== 'playing') throw Error('playing required');
      const choice = p.match.frame.pendingChoice;
      if (!choice || !('kind' in choice) || choice.kind !== 'combat-allocation') throw Error('allocation required');
      expect(other.match.frame.pendingChoice).toEqual({ active: true });
      const body = { type: 'assign-combat-damage' as const, choiceId: choice.choiceId,
        assignments: [{ unitObjectId: choice.targets[0]!.unitObjectId, amount: choice.budget }] };
      const before = f.runtime.project(null);
      expect(f.send(actor === 'alice' ? 'bob' : 'alice', body).result.ack.type).toBe('error');
      expect(f.runtime.project(null)).toEqual(before);
      const accepted = f.send(actor, body);
      expect(accepted.result.ack, JSON.stringify(accepted.result.ack)).toMatchObject({ ok: true });
      const settled = f.runtime.project(null);
      expect(f.runtime.dispatch(actor, accepted.packet).ack.duplicate).toBe(true);
      expect(f.runtime.project(null)).toEqual(settled);
    }
    const after = f.runtime.project('bob');
    if (after.match.stage !== 'playing') throw Error('playing required');
    expect(after.match.frame.pendingChoice).toBeNull();
    expect(after.match.frame.execution.status).toBe('ready');
    expect(after.match.board.battlefields.find(field => field.locationId === fieldId)?.combat).toBe('none');
  }, 45_000);

  it('reaches a real Hold win after two paid Units conquer both shared battlefields', async () => {
    const f = await fixture(), uids = [f.play('alice'), f.play('alice')];
    f.end('alice'); f.end('bob');
    const initial = f.runtime.project('alice');
    if (initial.match.stage !== 'playing') throw Error('playing required');
    const fields = initial.match.board.battlefields.map(field => field.locationId);
    for (let n = 0; n < 2; n++) {
      const move = f.runtime.project('alice').actions.find(action => action.kind === 'standard-move' && action.enabled);
      if (!move || move.kind !== 'standard-move') throw Error('Move required');
      expect(f.send('alice', { type: 'standard-move', unitUIDs: [uids[n]!],
        destinationLocationId: fields[n]!, windowId: move.windowId }).result.ack).toMatchObject({ ok: true });
      for (const actor of ['alice', 'bob']) {
        const pass = f.runtime.project(actor).actions.find(action => action.kind === 'pass-focus');
        if (!pass || pass.kind !== 'pass-focus') throw Error('Focus required');
        expect(f.send(actor, { type: 'pass-focus', windowId: pass.windowId }).result.ack).toMatchObject({ ok: true });
      }
    }
    for (let n = 0; n < 3; n++) { f.end('alice'); f.end('bob'); }
    const terminal = f.runtime.project('alice');
    if (terminal.match.stage !== 'playing') throw Error('playing required');
    expect(terminal.match.frame.phase).toBe('ended');
    expect(terminal.match.frame.stateOpen).toBe(false);
    expect(terminal.match.scoring.players.find(player => player.playerId === 'alice')?.points).toBe(8);
    expect(terminal.actions).toEqual([]);
    const opponent = f.runtime.project('bob');
    if (opponent.match.stage !== 'playing') throw Error('playing required');
    expect(opponent.match.scoring).toEqual(terminal.match.scoring);
  }, 60_000);
});
