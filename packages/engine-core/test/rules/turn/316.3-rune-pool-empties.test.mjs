// Scenarios `turn-main-phase-priority-and-rune-pool-empty` (CR v1.5 316.3 / 167 /
// 312.2.a / 310.1) and `turn-expiration-empties-rune-pool` (CR v1.5 317.2.d / 167).
//
// TurnFlow executes both phase boundaries by committing the exact pool payment to
// the authoritative host, leaving Rune permanents themselves untouched.
//
// The Priority half of the first scenario is executed in
// `312.2.a-turn-player-priority.test.mjs`, which shows the Turn Player holds Priority
// in the Neutral Open Main Phase (312.2.a / 310.1); the pool half remains blocked.
//
// The Priority half is observable through the Chain trace step `priority-granted` and
// through `chain.priority`/`turnState`. The scenario's `priority.gained` event itself
// has no TimingPointId in `src/events/timing-points.ts` (the file registers no priority
// entry at all), so the committed-timing form of that assertion cannot be written yet.
// Heal has the same shape: `heal` is missing from `ACTION_TIMINGS` in
// `src/events/action-adapter.ts`, so a Heal commits no timing at all even though
// turn.yaml scenarios (317.2.b) expect a `unit.healed` timing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../../turn/helpers.mjs';

test('turn-main-phase-priority-and-rune-pool-empty: both pools empty before Main priority', () => {
  const f = fixture({ energy: 5 });
  f.kernel.addPlayer('B', { energy: 2, power: ['Calm'] });
  f.flow.start();
  assert.equal(f.kernel.player('A').energy, 0);
  assert.equal(f.kernel.player('B').energy, 0);
  assert.deepEqual(f.kernel.player('B').power, []);
  assert.equal(f.flow.phase, 'main');
  assert.equal(f.flow.chain.priority, 'A');
});

test('turn-expiration-empties-rune-pool: ending cleanup empties both players pools', () => {
  const f = fixture({ energy: 3 });
  f.kernel.addPlayer('B', { energy: 4, power: ['Order'] });
  f.flow.start();
  f.flow.endTurn('A');
  assert.equal(f.kernel.player('A').energy, 0);
  assert.equal(f.kernel.player('B').energy, 0);
  assert.deepEqual(f.kernel.player('B').power, []);
});

test.todo('turn-main-phase-priority-and-rune-pool-empty / turn-expiration-empties-rune-pool: missing committed timings for the adjacent assertions — `priority-gained` is not a TimingPointId (only a Chain trace step) and `heal` is absent from ACTION_TIMINGS, so the scenarios\' `priority.gained` and `unit.healed` event entries cannot be asserted as committed timings (module: src/events/timing-points.ts + src/events/action-adapter.ts; op: none; timing: 312.2.a / 317.2.b). Shared-contract change request.');
