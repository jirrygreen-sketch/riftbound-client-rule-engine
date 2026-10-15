import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDuelEquipActivationSessionV1, beginDuelEquipActivationV1,
  applyDuelEquipActivationResourceV1, finalizeDuelEquipActivationV1,
  passDuelEquipActivationPriorityV1, resolveDuelEquipActivationV1,
  inspectDuelEquipActivationV1,
  resumeDuelEquipActivationPaymentV1, advanceDuelEquipActivationNativeV1,
} from '../dist/duel/equip-activation-v1.js';
import {
  applyDuelResourceCommandV2, commitDuelCommandFrameV2, advanceDuelCommandSessionNativeV2,
} from '../dist/duel/canonical-session-v2.js';
import { moveDuelUnitV2 } from '../dist/duel/core-v2.js';
import { finalizeDuelChainItemV2 } from '../dist/duel/chain-v2.js';
import { openScene, services, start, pay, costAuthority, equipCost } from './fixtures/equip-test-fixtures.mjs';

function command(session, actor, commandId, command) {
  return applyDuelEquipActivationResourceV1(session, actor, {
    commandId, expectedVersion: session.commandSession.match.stateVersion, command,
  });
}

test('Main Equip requires both current turn player and current priority player', () => {
  const scene = openScene();
  const wrongFrame = commitDuelCommandFrameV2(scene.session, {
    ...scene.session.match.frame, turnPlayerId: 'bob', priorityPlayerId: 'alice',
  }, () => {}).session;
  let parentHead = wrongFrame.match;
  const action = createDuelEquipActivationSessionV1(wrongFrame,
    services({ readHead: () => parentHead, commitHead: head => { parentHead = head; } }));
  const result = beginDuelEquipActivationV1(action, 'alice', {
    commandId: 'wrong-turn', expectedVersion: wrongFrame.match.stateVersion,
    command: { gearUID: scene.gear.uid, targetUID: scene.unit.uid },
  });
  assert.equal(result.outcome.status, 'rejected');
  assert.equal(action.commandSession.match.chainCards?.length ?? 0, 0);
});

test('An external native resource commit rejects an old Equip handle at admission', () => {
  const scene = openScene();
  const native = scene.session;
  let parentHead = native.match;
  const action = createDuelEquipActivationSessionV1(native,
    services({ readHead: () => parentHead, commitHead: head => { parentHead = head; } }));
  const rune = native.match.resources.bases[0].baseRunes[0].uid;
  const advanced = applyDuelResourceCommandV2(native, 'alice', {
    commandId: 'external-rune', expectedVersion: native.match.stateVersion,
    command: { type: 'rune-energy', uid: rune },
  });
  assert.equal(advanced.outcome.status, 'applied');
  parentHead = advanced.session.match;
  const stale = beginDuelEquipActivationV1(action, 'alice', {
    commandId: 'stale-equip', expectedVersion: native.match.stateVersion,
    command: { gearUID: scene.gear.uid, targetUID: scene.unit.uid },
  });
  assert.deepEqual(stale.outcome, { status: 'blocked', reason: 'stale-head' });
  assert.equal(stale.session.commandSession.match, native.match);
});

test('A payment-rejected receipt remains rejected at the Equip boundary and spends nothing', () => {
  const scene = openScene();
  let parentHead = scene.session.match;
  const service = services({ readHead: () => parentHead, commitHead: head => { parentHead = head; } });
  const source = service.sourceAttestor;
  let rejectPayment = false;
  service.sourceAttestor = request => {
    const value = source(request);
    return rejectPayment ? { ...value, sourceZoneEpoch: value.sourceZoneEpoch + 1 } : value;
  };
  scene.session = createDuelEquipActivationSessionV1(scene.session, service);
  const begun = beginDuelEquipActivationV1(scene.session, 'alice', {
    commandId: 'payment-rejected', expectedVersion: scene.session.commandSession.match.stateVersion,
    command: { gearUID: scene.gear.uid, targetUID: scene.unit.uid },
  });
  scene.session = begun.session;
  const rune = scene.session.commandSession.match.resources.bases[0].baseRunes[0].uid;
  const funded = command(scene.session, 'alice', 'fund', { type: 'rune-energy', uid: rune });
  scene.session = funded.session;
  const before = scene.session.commandSession.match.resources.players
    .find(value => value.playerId === 'alice').runePool.energy;
  rejectPayment = true;
  const rejected = command(scene.session, 'alice', 'reject-pay', {
    type: 'pay-pending', paymentId: begun.outcome.paymentId,
  });
  scene.session = rejected.session;
  assert.deepEqual(rejected.outcome, { status: 'rejected', reason: 'payment-rejected' });
  assert.deepEqual(scene.session.commandSession.receipts.at(-1).outcome,
    { status: 'rejected', reason: 'payment-rejected' });
  assert.equal(scene.session.commandSession.match.resources.players
    .find(value => value.playerId === 'alice').runePool.energy, before);
});

test('Mixed Energy and Fury Power is paid once before double-pass attachment', () => {
  const scene = openScene();
  let parentHead = scene.session.match;
  const service = services({
    equip: { energy: 1, power: [{ allowedDomains: ['Fury'], amount: 1 }] },
    readHead: () => parentHead, commitHead: head => { parentHead = head; },
  });
  scene.session = createDuelEquipActivationSessionV1(scene.session, service);
  const begun = beginDuelEquipActivationV1(scene.session, 'alice', {
    commandId: 'mixed-cost', expectedVersion: scene.session.commandSession.match.stateVersion,
    command: { gearUID: scene.gear.uid, targetUID: scene.unit.uid },
  });
  scene.session = begun.session;
  const runes = scene.session.commandSession.match.resources.bases
    .find(value => value.playerId === 'alice').baseRunes.map(value => value.uid);
  scene.session = command(scene.session, 'alice', 'mixed-energy', { type: 'rune-energy', uid: runes[0] }).session;
  scene.session = command(scene.session, 'alice', 'mixed-power', { type: 'rune-power', uid: runes[1] }).session;
  const paid = command(scene.session, 'alice', 'mixed-pay', {
    type: 'pay-pending', paymentId: begun.outcome.paymentId,
  });
  assert.equal(paid.outcome.status, 'paid');
  scene.session = paid.session;
  let result = finalizeDuelEquipActivationV1(scene.session, 'alice'); scene.session = result.session;
  result = passDuelEquipActivationPriorityV1(scene.session, 'alice'); scene.session = result.session;
  result = passDuelEquipActivationPriorityV1(scene.session, 'bob'); scene.session = result.session;
  assert.equal(result.outcome.step, 'resolve');
  result = resolveDuelEquipActivationV1(scene.session); scene.session = result.session;
  assert.deepEqual(result.outcome.status, 'applied');
  assert.equal(result.outcome.attached, true);
  assert.equal(scene.session.commandSession.match.gears.find(value => value.uid === scene.gear.uid).attachedToUID,
    scene.unit.uid);
});

test('A changed currentHead getter blocks without issuing a Chain item', () => {
  const scene = openScene();
  const native = scene.session;
  let reads = 0;
  const changed = commitDuelCommandFrameV2(native,
    { ...native.match.frame, priorityPlayerId: 'bob' }, () => {}).session;
  const action = createDuelEquipActivationSessionV1(native, services({
    readHead: () => (++reads === 1 ? native.match : changed.match),
  }));
  const result = beginDuelEquipActivationV1(action, 'alice', {
    commandId: 'getter-changed', expectedVersion: native.match.stateVersion,
    command: { gearUID: scene.gear.uid, targetUID: scene.unit.uid },
  });
  assert.deepEqual(result.outcome, { status: 'blocked', reason: 'stale-head' });
  assert.equal(action.chain.items.length, 0);
});

test('late-stale-getter: settle returns stale-head without resources, receipts or Chain changes', () => {
  const scene = openScene();
  const native = scene.session;
  const changed = applyDuelResourceCommandV2(native, 'alice', {
    commandId: 'sibling-rune', expectedVersion: native.match.stateVersion,
    command: { type: 'rune-energy', uid: native.match.resources.bases[0].baseRunes[0].uid },
  });
  assert.equal(changed.outcome.status, 'applied');
  let reads = 0;
  let stale = true;
  scene.session = createDuelEquipActivationSessionV1(native, services({
    readHead: () => stale && ++reads >= 3 ? changed.session.match :
      scene.session.commandSession?.match ?? scene.session.match,
  }));
  const before = scene.session;
  const result = start(scene, 'late-stale-getter');
  assert.deepEqual(result.outcome, { status: 'blocked', reason: 'stale-head' });
  assert.equal(result.session, before);
  assert.equal(result.persistRequired, false);
  assert.equal(result.session.commandSession.match.resources, native.match.resources);
  assert.equal(result.session.commandSession.receipts, native.receipts);
  assert.equal(result.session.commandSession.requiredTasks, native.requiredTasks);
  assert.equal(result.session.chain, before.chain);
  assert.equal(result.session.chain.items.length, 0);
  stale = false;
  assert.equal(inspectDuelEquipActivationV1(scene.session).phase, 'idle');
  const retried = start(scene, 'late-stale-getter');
  assert.equal(retried.outcome.status, 'pending');
  assert.equal(retried.duplicate, false);
});

test('readHead-reentry-finalize: caught inspection reentry cannot advance priority', () => {
  const scene = openScene();
  let reenter = false;
  let nested;
  scene.session = createDuelEquipActivationSessionV1(scene.session, services({ readHead: () => {
    if (reenter) {
      try { inspectDuelEquipActivationV1(scene.session); }
      catch (error) { nested = error; }
    }
    return scene.session.commandSession?.match ?? scene.session.match;
  } }));
  const begun = start(scene);
  assert.equal(pay(scene, begun).outcome.status, 'paid');
  const before = scene.session;
  reenter = true;
  const result = finalizeDuelEquipActivationV1(before, 'alice');
  assert.match(nested?.message ?? '', /reentrant command/);
  assert.deepEqual(result.outcome, { status: 'blocked', reason: 'reentrant-command' });
  assert.equal(result.session, before);
  assert.equal(result.persistRequired, false);
  assert.equal(before.chain.items[0].status, 'pending');
  reenter = false;
  assert.equal(inspectDuelEquipActivationV1(before).phase, 'paid');
  const retried = finalizeDuelEquipActivationV1(before, 'alice');
  assert.equal(retried.outcome.step, 'priority');
  assert.equal(retried.session.chain.items[0].status, 'finalized');
});

function callbackScene(step) {
  const scene = openScene();
  const native = scene.session;
  const sibling = applyDuelResourceCommandV2(native, 'alice', {
    commandId: 'callback-sibling', expectedVersion: native.match.stateVersion,
    command: { type: 'rune-energy', uid: native.match.resources.bases[0].baseRunes[0].uid },
  });
  assert.equal(sibling.outcome.status, 'applied');
  let parentHead = native.match;
  const hooks = {};
  const service = services({
    readHead: () => hooks.read ? hooks.read(parentHead) : parentHead,
    commitHead: head => {
      hooks.commit?.(head);
      parentHead = head;
    },
  });
  const factory = service.costForActivation;
  let costKnown = step !== 'resume';
  service.costForActivation = request => {
    if (!costKnown) throw new TypeError('cost census unavailable');
    return factory(request);
  };
  if (step === 'issued') {
    const attestor = service.sourceAttestor;
    let attestations = 0;
    service.sourceAttestor = request => {
      if (++attestations === 2) throw new TypeError('temporary source census unavailable');
      return attestor(request);
    };
  }
  scene.session = createDuelEquipActivationSessionV1(native, service);
  let invoke = () => beginDuelEquipActivationV1(scene.session, 'alice', {
    commandId: 'callback-begin', expectedVersion: native.match.stateVersion,
    command: { gearUID: scene.gear.uid, targetUID: scene.unit.uid },
  });
  if (step !== 'begin') {
    const begun = start(scene);
    if (step === 'resume' || step === 'issued') {
      assert.equal(begun.outcome.status, 'blocked');
      costKnown = true;
      invoke = () => resumeDuelEquipActivationPaymentV1(scene.session);
    } else {
      assert.equal(begun.outcome.step, 'payment');
      if (step === 'resource') {
        const rune = scene.session.commandSession.match.resources.bases[0].baseRunes[0].uid;
        scene.session = command(scene.session, 'alice', 'callback-fund', { type: 'rune-energy', uid: rune }).session;
        invoke = () => command(scene.session, 'alice', 'callback-pay', {
          type: 'pay-pending', paymentId: begun.outcome.paymentId,
        });
      } else {
        assert.equal(pay(scene, begun).outcome.status, 'paid');
        invoke = () => finalizeDuelEquipActivationV1(scene.session, 'alice');
        if (step === 'pass' || step === 'resolve') {
          const finalized = finalizeDuelEquipActivationV1(scene.session, 'alice');
          assert.equal(finalized.outcome.step, 'priority');
          scene.session = finalized.session;
          invoke = () => passDuelEquipActivationPriorityV1(scene.session, 'alice');
        }
        if (step === 'resolve') {
          scene.session = passDuelEquipActivationPriorityV1(scene.session, 'alice').session;
          const passed = passDuelEquipActivationPriorityV1(scene.session, 'bob');
          assert.equal(passed.outcome.step, 'resolve');
          scene.session = passed.session;
          invoke = () => resolveDuelEquipActivationV1(scene.session);
        }
        if (step === 'native') {
          const moved = moveDuelUnitV2(scene.session.commandSession.match, scene.unit.uid,
            scene.session.commandSession.match.board.battlefields[0].locationId);
          const descendant = advanceDuelCommandSessionNativeV2(scene.session.commandSession, moved).session;
          invoke = () => advanceDuelEquipActivationNativeV1(scene.session, descendant);
        }
        if (step === 'inspect') invoke = () => inspectDuelEquipActivationV1(scene.session);
      }
    }
  }
  return { scene, hooks, service, invoke, staleHead: sibling.session.match,
    parent: () => parentHead };
}

for (const step of ['begin', 'resource', 'resume', 'issued', 'finalize', 'pass', 'resolve']) {
  for (const boundary of ['admission', 'settle', 'commit', 'committed-read']) {
    test(`${step}: caught read/commit reentry at ${boundary} rolls back and permits a real retry`, () => {
      const harness = callbackScene(step);
      const { scene, hooks, invoke } = harness;
      const before = scene.session;
      const inspection = inspectDuelEquipActivationV1(before);
      let nested = 0;
      const reenter = () => {
        assert.throws(() => inspectDuelEquipActivationV1(before), /reentrant command/);
        nested++;
      };
      let reads = 0;
      const at = { admission: 1, settle: 2, 'committed-read': 3 }[boundary];
      if (boundary === 'commit') hooks.commit = reenter;
      else hooks.read = head => {
        if (++reads === at) reenter();
        return head;
      };
      const result = invoke();
      assert.ok(nested > 0);
      assert.deepEqual(result.outcome, { status: 'blocked', reason: 'reentrant-command' });
      assert.equal(result.session, before);
      assert.equal(result.persistRequired, false);
      assert.equal(result.session.commandSession, before.commandSession);
      assert.equal(result.session.chain, before.chain);
      hooks.read = undefined; hooks.commit = undefined;
      assert.equal(harness.parent(), before.commandSession.match);
      assert.deepEqual(inspectDuelEquipActivationV1(before), inspection);
      const retried = invoke();
      assert.ok(['pending', 'paid', 'applied'].includes(retried.outcome.status));
      assert.equal(retried.duplicate, false);
      assert.equal(retried.session.chain.stateVersion,
        before.chain.stateVersion + ({ begin: 1, resource: 0, resume: 0, issued: 0, finalize: 1, pass: 1, resolve: 2 }[step]));
      if (step === 'issued') {
        scene.session = retried.session;
        assert.equal(scene.session.commandSession.requiredTasks.length, 1);
        assert.equal(pay(scene, retried).outcome.status, 'paid');
      }
    });
  }
  test(`${step}: stale settlement preserves the exact resource, receipt and Chain head`, () => {
    const harness = callbackScene(step);
    const { scene, hooks, invoke, staleHead } = harness;
    const before = scene.session;
    const inspection = inspectDuelEquipActivationV1(before);
    let reads = 0;
    hooks.read = head => ++reads >= 2 ? staleHead : head;
    const result = invoke();
    assert.deepEqual(result.outcome, { status: 'blocked', reason: 'stale-head' });
    assert.equal(result.session, before);
    assert.equal(result.persistRequired, false);
    assert.equal(result.session.commandSession.match.resources, before.commandSession.match.resources);
    assert.equal(result.session.commandSession.receipts, before.commandSession.receipts);
    assert.equal(result.session.commandSession.requiredTasks, before.commandSession.requiredTasks);
    assert.equal(result.session.chain, before.chain);
    hooks.read = undefined;
    assert.deepEqual(inspectDuelEquipActivationV1(before), inspection);
    assert.ok(['pending', 'paid', 'applied'].includes(invoke().outcome.status));
  });
}

for (const provider of ['registry', 'program', 'costForActivation', 'costBinding', 'costService', 'costVerifier', 'sourceAttestor']) {
  test(`begin: caught ${provider} reentry cannot leave a claim or an advanced Chain`, () => {
    const { scene, service, invoke } = callbackScene('begin');
    const before = scene.session;
    let nested = 0;
    const reenter = () => {
      assert.throws(() => inspectDuelEquipActivationV1(before), /reentrant command/);
      nested++;
    };
    let restore;
    if (provider === 'registry') {
      const original = service.programs.getProgram;
      service.programs.getProgram = request => { reenter(); return original(request); };
      restore = () => { service.programs.getProgram = original; };
    } else if (provider === 'costService' || provider === 'costVerifier') {
      const original = service.costForActivation;
      service.costForActivation = () => costAuthority(equipCost,
        provider === 'costService' ? { service: reenter } : { verifier: reenter });
      restore = () => { service.costForActivation = original; };
    } else {
      const original = service[provider];
      service[provider] = request => { reenter(); return original(request); };
      restore = () => { service[provider] = original; };
    }
    const result = invoke();
    assert.ok(nested > 0);
    assert.ok(['blocked', 'rejected'].includes(result.outcome.status));
    assert.equal(result.session, before);
    assert.equal(result.persistRequired, false);
    assert.equal(result.session.commandSession, before.commandSession);
    assert.equal(before.chain.items.length, 0);
    restore();
    assert.equal(inspectDuelEquipActivationV1(before).phase, 'idle');
    assert.equal(invoke().outcome.step, 'payment');
  });
}

test('resource: source attestor reentry remains blocked instead of publishing a payment-rejected receipt', () => {
  const { scene, service, invoke } = callbackScene('resource');
  const before = scene.session;
  const original = service.sourceAttestor;
  service.sourceAttestor = request => {
    assert.throws(() => inspectDuelEquipActivationV1(before), /reentrant command/);
    return original(request);
  };
  const result = invoke();
  assert.deepEqual(result.outcome, { status: 'blocked', reason: 'reentrant-command' });
  assert.equal(result.session, before);
  assert.equal(result.session.commandSession.receipts, before.commandSession.receipts);
  assert.equal(result.session.commandSession.match.resources, before.commandSession.match.resources);
  service.sourceAttestor = original;
  assert.equal(invoke().outcome.status, 'paid');
});

for (const step of ['inspect', 'native']) {
  test(`${step}: read callback reentry throws without returning a false success`, () => {
    const { scene, hooks, invoke } = callbackScene(step);
    const before = scene.session;
    const inspection = inspectDuelEquipActivationV1(before);
    hooks.read = head => {
      assert.throws(() => inspectDuelEquipActivationV1(before), /reentrant command/);
      return head;
    };
    assert.throws(invoke, /reentrant command/);
    hooks.read = undefined;
    assert.deepEqual(inspectDuelEquipActivationV1(before), inspection);
    const retried = invoke();
    if (step === 'native') assert.notEqual(retried.commandSession.match, before.commandSession.match);
    else assert.deepEqual(retried, inspection);
  });
}

test('a new pay command after actual payment is rejected without spending Energy twice', () => {
  const { scene, invoke } = callbackScene('resource');
  const paid = invoke();
  assert.equal(paid.outcome.status, 'paid');
  scene.session = paid.session;
  const resources = scene.session.commandSession.match.resources;
  const rejected = command(scene.session, 'alice', 'double-pay', {
    type: 'pay-pending', paymentId: scene.session.commandSession.requiredTasks[0].paymentId,
  });
  assert.deepEqual(rejected.outcome, { status: 'rejected', reason: 'resource-rejected' });
  assert.equal(rejected.session.commandSession.match.resources, resources);
  assert.equal(rejected.duplicate, false);
});

test('resolve: identity factory reentry cannot lock a Chain ticket or attach Gear', () => {
  const { scene, service, invoke } = callbackScene('resolve');
  const before = scene.session;
  let identities = 0;
  service.identityFactory = () => {
    assert.throws(() => inspectDuelEquipActivationV1(before), /reentrant command/);
    return `reentered-ticket-${++identities}`;
  };
  const result = invoke();
  assert.deepEqual(result.outcome, { status: 'blocked', reason: 'reentrant-command' });
  assert.equal(result.session, before);
  assert.equal(before.chain.phase, 'resolve');
  assert.equal(before.commandSession.match.gears.find(value => value.uid === scene.gear.uid).attachedToUID, null);
  service.identityFactory = () => `recovered-ticket-${++identities}`;
  const retried = invoke();
  assert.equal(retried.outcome.status, 'applied');
  assert.equal(retried.outcome.attached, true);
});

for (const boundary of ['settle', 'commit', 'committed-read']) {
  test(`native: ${boundary} reentry throws and leaves the original continuation usable`, () => {
    const { scene, hooks, invoke, parent } = callbackScene('native');
    const before = scene.session;
    const inspection = inspectDuelEquipActivationV1(before);
    const reenter = () => assert.throws(() => inspectDuelEquipActivationV1(before), /reentrant command/);
    let reads = 0;
    if (boundary === 'commit') hooks.commit = reenter;
    else hooks.read = head => {
      if (++reads === (boundary === 'settle' ? 2 : 3)) reenter();
      return head;
    };
    assert.throws(invoke, /reentrant command/);
    hooks.read = undefined; hooks.commit = undefined;
    assert.equal(parent(), before.commandSession.match);
    assert.deepEqual(inspectDuelEquipActivationV1(before), inspection);
    assert.notEqual(invoke().commandSession.match, before.commandSession.match);
  });
}

test('working Chain isolation does not admit an externally consumed native continuation', () => {
  const { scene, invoke } = callbackScene('finalize');
  const before = scene.session;
  const advanced = finalizeDuelChainItemV2(before.chain, { actor: 'alice', expectedVersion: before.chain.stateVersion });
  assert.equal(advanced.items[0].status, 'finalized');
  const result = invoke();
  assert.deepEqual(result.outcome, { status: 'blocked', reason: 'chain-unproved' });
  assert.equal(result.session, before);
  assert.equal(result.persistRequired, false);
});

for (const fault of ['stale-head', 'reentrant-command']) {
  test(`static cost authority: ${fault} rollback retains the genuine resolved transaction for retry`, () => {
    const harness = callbackScene('begin');
    const { scene, service, hooks, invoke, staleHead } = harness;
    service.costForActivation = undefined;
    const before = scene.session;
    const bind = service.costBinding;
    let reads = 0;
    if (fault === 'stale-head') hooks.read = head => ++reads >= 2 ? staleHead : head;
    else service.costBinding = request => {
      assert.throws(() => inspectDuelEquipActivationV1(before), /reentrant command/);
      return bind(request);
    };
    const blocked = invoke();
    assert.deepEqual(blocked.outcome, { status: 'blocked', reason: fault });
    assert.equal(blocked.session, before);
    assert.equal(blocked.persistRequired, false);
    assert.equal(blocked.session.commandSession, before.commandSession);
    hooks.read = undefined; service.costBinding = bind;
    const retried = invoke();
    assert.equal(retried.outcome.step, 'payment');
    assert.equal(retried.duplicate, false);
    scene.session = retried.session;
    assert.equal(pay(scene, retried).outcome.status, 'paid');
  });
}
