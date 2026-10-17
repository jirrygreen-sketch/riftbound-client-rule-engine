// Scenarios `turn-negative-draw-as-discretionary` (CR v1.5 414.2 / 411.2),
// `turn-negative-ready-as-discretionary` (CR v1.5 416.3 / 411.2) and
// `turn-negative-channel-as-discretionary` (CR v1.5 431.4 / 411.2).
//
// Draw, Ready and Channel are Limited Actions: a player may take them only when a
// game effect or the turn's own structure instructs it. In the merged kernel none of
// them is reachable as a discretionary command at all — the turn driver issues the
// Draw Phase draw (`src/turn/flow.ts` `draw`), the Awaken Readies
// (`scheduleTurn`), and the Channel Phase channels; the primitives that carry these
// actions (`effect.draw`, `effect.ready`, `effect.channel`) are only reachable from a
// resolving effect. A test whose content is "this command does not exist" would be the
// forbidden “assert the feature is absent” shape and would not pin any rule, so the
// gap is recorded instead. What *is* executed for the same rule family is the timing
// guard that rejects an illegal discretionary play during a Closed State
// (`309.1.a-closed-state-requires-reaction.test.mjs`).
import test from 'node:test';

test.todo('turn-negative-draw-as-discretionary: blocked — there is no discretionary Draw command to reject; the action is owned by the Draw Phase task and by `effect.draw` (CR 414.2 / 411.2; module: src/turn/flow.ts `draw`; op: effect.draw as the instructed form only; timing: 315.4 Draw Phase). Test would only assert the absence of a feature.');

test.todo('turn-negative-ready-as-discretionary: blocked — there is no discretionary Ready command to reject; the action is owned by the Awaken Phase task (and by a Stun-consuming Ready that is itself blocked) and by `effect.ready` (CR 416.3 / 411.2; module: src/turn/flow.ts `scheduleTurn`; op: effect.ready as the instructed form only; timing: 315.1 Awaken Phase). Test would only assert the absence of a feature.');

test.todo('turn-negative-channel-as-discretionary: blocked — there is no discretionary Channel command to reject; the action is owned by the Channel Phase task and by `effect.channel` (CR 431.4 / 411.2; module: src/turn/flow.ts `scheduleTurn`; op: effect.channel as the instructed form only; timing: 315.3 Channel Phase). Test would only assert the absence of a feature.');
