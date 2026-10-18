import test from 'node:test';
import assert from 'node:assert/strict';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { resolveChainBody } from '../../dist/chain/interpreter-adapter.js';
import { fixture, resolveAll } from '../chain/helpers.mjs';

/** Unwrap a choice.optional literal body; production cards nest these. */
function choiceBody(instruction) {
  const expression = instruction.args.body;
  assert(expression && (expression.kind === 'constant' || expression.kind === 'literal'));
  return expression.value;
}

/** Load raw production card IR from the built card-dsl package. */
const cardCache = new Map();
async function card(name) {
  if (!cardCache.has(name)) {
    cardCache.set(name, import('../../../card-dsl/dist/cards/' + name + '.js').then(module => module.default));
  }
  return cardCache.get(name);
}

// The card DSL wraps every top-level argument in an Expr envelope; production
// primitive schemas require literal metadata fields. These fixtures execute the
// original IR through resolveChainBody and the ChainEngine without hand-settling.


// A triggered ability finalized by the chain locks its targets through
// TargetPlan; resolution re-derives the same set from those plans.
test('kennen keeper of balance: pay cost and stun literal targets pass the adapter', async () => {
  const program = await card('ven/kennen-keeper-of-balance');
  const [optIn] = program.abilities[1].body;
  const f = fixture();
  f.kernel.addObject({ ref: { id: 'enemy-unit', zoneEntryId: 1 }, cardId: 'card:enemy-unit', name: 'enemy-unit', types: ['unit'], owner: 'B', controller: 'B', zone: 'board', location: { type: 'battlefield', id: 'battlefield-1' }, might: 2 });
  // The nested optional instructions carry a targets requirement, so the
  // production finalize surface (EG-FINALIZE) blocks the full ChainEngine
  // path. Resolve the pay/stun body through the production adapter and the
  // locked-target context instead.
  const inner = optIn.args.body.value;
  const pay = inner.find(instruction => instruction.op === 'cost.pay');
  const stun = inner.find(instruction => instruction.op === 'effect.stun');
  f.kernel.setTargets('kennen.play.unit', [f.kernel.ref('enemy-unit')]);
  f.answers.set('kennen.play.opt-in/optional', true);
  const result = resolveChainBody([pay, stun], f.host.context(f.kernel.getObject('source'), 'A', 'chain-item-resolve'));
  assert.deepEqual(result.results.map(entry => ({ id: entry.id, status: entry.result.status })), [
    { id: 'kennen.play.pay', status: 'executed' },
    { id: 'kennen.play.stun', status: 'executed' }
  ]);
  assert.equal(f.kernel.getObject('enemy-unit').stunned, true);
  assert.equal(f.kernel.player('A').energy, 18);
});

// Alpha Strike reads divide: true from its own IR; the damage primitive asks
// the controller for the split only at resolution. A withheld answer rolls the
// settlement back and the retry resubmits the identical request id.
test('alpha strike: divide rolls back, retries the same request, then settles', async () => {
  const program = await card('unl/alpha-strike');
  const [body] = program.abilities[1].body;
  const f = fixture();
  f.kernel.addObject({ ref: { id: 'champ', zoneEntryId: 1 }, cardId: 'card:champ', name: 'champ', types: ['unit'], owner: 'A', controller: 'A', zone: 'board', location: { type: 'battlefield', id: 'battlefield-1' }, might: 2 });
  f.kernel.addObject({ ref: { id: 'enemy-1', zoneEntryId: 1 }, cardId: 'card:enemy-1', name: 'enemy-1', types: ['unit'], owner: 'B', controller: 'B', zone: 'board', location: { type: 'battlefield', id: 'battlefield-1' }, might: 3 });
  f.engine.execute(f.draft('alpha-strike-play', {
    kind: 'spell',
    body: [body],
    targets: [
      { requirement: body.targets[0], options: { selected: [f.kernel.ref('champ')] } },
      { requirement: body.targets[1], options: { selected: [f.kernel.ref('enemy-1')] } }
    ]
  }));
  f.engine.pass('A');
  const events = f.engine.pipeline.events;
  const links = f.kernel.linkedSnapshot();
  let request;
  assert.throws(() => f.engine.pass('B'), error => {
    assert.ok(error instanceof AwaitChoice); request = error.request; return true;
  });
  assert.equal(f.kernel.getObject('enemy-1').damage, 0);
  assert.equal(f.engine.items.length, 1);
  assert.deepEqual(f.engine.pipeline.events, events);
  assert.deepEqual(f.kernel.linkedSnapshot(), links);
  // The retry after rollback must resubmit the same deterministic request id.
  assert.throws(() => f.engine.pass('B'), error => {
    assert.ok(error instanceof AwaitChoice); assert.equal(error.request.id, request.id); return true;
  });
  f.answers.set(request.id, 2);
  f.engine.pass('B');
  assert.equal(f.kernel.getObject('enemy-1').damage, 2);
  assert.equal(f.engine.items.length, 0);

  // Two identical worlds replay the settled allocation exactly.
  const replay = fixture();
  replay.kernel.addObject({ ref: { id: 'champ', zoneEntryId: 1 }, cardId: 'card:champ', name: 'champ', types: ['unit'], owner: 'A', controller: 'A', zone: 'board', location: { type: 'battlefield', id: 'battlefield-1' }, might: 2 });
  replay.kernel.addObject({ ref: { id: 'enemy-1', zoneEntryId: 1 }, cardId: 'card:enemy-1', name: 'enemy-1', types: ['unit'], owner: 'B', controller: 'B', zone: 'board', location: { type: 'battlefield', id: 'battlefield-1' }, might: 3 });
  replay.engine.execute(replay.draft('alpha-strike-play', {
    kind: 'spell',
    body: [body],
    targets: [
      { requirement: body.targets[0], options: { selected: [replay.kernel.ref('champ')] } },
      { requirement: body.targets[1], options: { selected: [replay.kernel.ref('enemy-1')] } }
    ]
  }));
  replay.engine.pass('A');
  let replayRequest;
  assert.throws(() => replay.engine.pass('B'), error => {
    assert.ok(error instanceof AwaitChoice); replayRequest = error.request; return true;
  });
  replay.answers.set(replayRequest.id, 2);
  replay.engine.pass('B');
  assert.equal(replay.kernel.getObject('enemy-1').damage, 2);
});

// 355.14.e-f: an allocation outside 1..max is impossible and the whole
// instruction is negated; nothing may be dealt.
test('alpha strike: an out-of-range divide answer is rejected without damage', async () => {
  const program = await card('unl/alpha-strike');
  const [body] = program.abilities[1].body;
  const f = fixture();
  f.kernel.addObject({ ref: { id: 'champ', zoneEntryId: 1 }, cardId: 'card:champ', name: 'champ', types: ['unit'], owner: 'A', controller: 'A', zone: 'board', location: { type: 'battlefield', id: 'battlefield-1' }, might: 2 });
  f.kernel.addObject({ ref: { id: 'enemy-1', zoneEntryId: 1 }, cardId: 'card:enemy-1', name: 'enemy-1', types: ['unit'], owner: 'B', controller: 'B', zone: 'board', location: { type: 'battlefield', id: 'battlefield-1' }, might: 3 });
  f.engine.execute(f.draft('alpha-strike-play', {
    kind: 'spell',
    body: [body],
    targets: [
      { requirement: body.targets[0], options: { selected: [f.kernel.ref('champ')] } },
      { requirement: body.targets[1], options: { selected: [f.kernel.ref('enemy-1')] } }
    ]
  }));
  f.engine.pass('A');
  let request;
  assert.throws(() => f.engine.pass('B'), error => {
    assert.ok(error instanceof AwaitChoice); request = error.request; return true;
  });
  f.answers.set(request.id, 0);
  f.engine.pass('B');
  assert.equal(f.kernel.getObject('enemy-1').damage, 0);
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.pipeline.events.filter(event => event.reason === 'damage-dealt').length, 0);
});

// The baroness activation builds an activated cost plan from literal args.
test('chem baroness: cost.modify literal args freeze a plan through the adapter', async () => {
  const program = await card('sfd/chem-baroness');
  const activation = program.abilities[0].body[0];
  const planInstruction = choiceBody(activation).find(instruction => instruction.op === 'cost.modify');
  assert.ok(planInstruction);
  const f = fixture();
  f.kernel.addObject({ ref: { id: 'baroness', zoneEntryId: 1 }, cardId: 'card:baroness', name: 'baroness', types: ['gear'], owner: 'A', controller: 'A', zone: 'board', location: { type: 'base', player: 'A' }, might: null, energy: null });
  const result = resolveChainBody(
    [planInstruction],
    f.host.context(f.kernel.getObject('baroness'), 'A', 'chain-item-resolve')
  );
  assert.equal(result.results[0].result.status, 'executed');
  const plan = result.results[0].result.linkedValues.cost;
  assert.equal(plan.id, 'chem-baroness.prepare-exhaust');
  assert.equal(plan.player, 'A');
  assert.equal(plan.source.id, 'baroness');
  assert.deepEqual(plan.total.actions, [{
    id: 'base:payment:0:0',
    componentId: 'base',
    action: { type: 'exhaust', object: { id: 'baroness', zoneEntryId: 1 } }
  }]);
  assert.equal(plan.components[0].kind, 'activated');
});

// Riven-Shattered reuses the Weaponmaster expansion; its cost.modify body
// must still parse through the adapter and stay judge-required (CR 821.1.c.2).
test('riven shattered: cost.modify source branch stays judge-required', async () => {
  const program = await card('ven/riven-shattered');
  const weaponmaster = (await import('../../dist/effects/keywords/Weaponmaster.js')).default;
  const ability = weaponmaster.expand({ host: program }).find(entry => entry.body);
  assert.ok(ability);
  const [sequence] = ability.body;
  const instructions = choiceBody(sequence);
  const costModify = instructions.find(instruction => instruction.op === 'cost.modify');
  assert.ok(costModify);
  const f = fixture();
  f.kernel.addObject({ ref: { id: 'equipment', zoneEntryId: 1 }, cardId: 'card:equipment', name: 'equipment', types: ['gear'], tags: ['Equipment'], owner: 'A', controller: 'A', zone: 'board', location: { type: 'base', player: 'A' } });
  f.kernel.setTargets('weaponmaster-equipment', [f.kernel.ref('equipment')]);
  assert.throws(() => resolveChainBody([costModify], f.host.context(
    f.kernel.getObject('source'), 'A', 'chain-item-resolve'
  )), error => {
    assert.match(error.message, /821\.1\.c\.2/);
    assert.match(error.message, /judge-required/);
    return true;
  });
});

// Fresh Beans anchors exhaust-this as a literal choose instead of a target.
// The choice stays replayable and the linked draw executes after paying.
test('fresh beans: exhaust choose literal runs and the linked draw follows', async () => {
  const program = await card('unl/fresh-beans');
  const body = program.abilities[0].body;
  const f = fixture();
  f.kernel.addObject({ ref: { id: 'beans', zoneEntryId: 1 }, cardId: 'card:beans', name: 'beans', types: ['gear'], owner: 'A', controller: 'A', zone: 'board', location: { type: 'base', player: 'A' }, might: null, energy: null });
  const context = f.host.context(f.kernel.getObject('beans'), 'A', 'chain-item-resolve');
  const result = resolveChainBody(body, context);
  assert.equal(result.results[0].result.status, 'executed');
  assert.equal(f.kernel.getObject('beans').exhausted, true);
  assert.equal(result.results[0].result.linkedValues.exhausted.count, 1);
  assert.equal(result.results[1].result.status, 'executed');
  assert.equal(f.kernel.player('A').handSize, 1);
});

// Fretful Feline is the exact production regression for the settlement
// counter: the second ready settlement must register its own identity and not
// collide with the first (CR 416.1/416.2, 478.1, 317.2.c).
test('fretful feline: repeated ready settlements register distinct identities', async () => {
  const program = await card('ven/fretful-feline');
  const [body] = program.abilities[0].body;
  const f = fixture();
  f.kernel.addObject({ ref: { id: 'cat', zoneEntryId: 1 }, cardId: 'card:cat', name: 'cat', types: ['unit'], owner: 'A', controller: 'A', zone: 'board', location: { type: 'battlefield', id: 'battlefield-1' }, might: 5 });
  f.engine.pipeline.registerTrigger({
    id: 'cat-trigger-1',
    source: f.kernel.getObject('cat'),
    controller: 'A',
    spec: { at: 'object-readied', filter: { event: 'object-readied', object: { objectId: 'cat' } } },
    body: [body]
  });
  f.engine.commit({ type: 'ready', object: f.kernel.ref('cat') });
  f.engine.advance();
  resolveAll(f.engine);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref('cat')).might, 7);
  f.engine.commit({ type: 'ready', object: f.kernel.ref('cat') });
  f.engine.advance();
  resolveAll(f.engine);
  assert.equal(f.engine.layers.evaluate(f.kernel.ref('cat')).might, 9);
  const entries = f.engine.layers.registry.snapshot();
  const ids = entries.map(entry => entry.effect.id).filter(id => id.includes('settlement'));
  assert.equal(new Set(ids.map(id => id.replace(/settlement-\d+/, 'settlement-N'))).size, 1);
  assert.ok(ids.some(id => id.includes('settlement-1')), JSON.stringify(ids));
  assert.ok(ids.some(id => id.includes('settlement-2')), JSON.stringify(ids));
  assert.equal(f.kernel.linked('__continuous.settlement.continuous.might.cat.1'), 2);
});

// Two independent worlds produce byte-identical registration ids, so a
// settlement can be replayed from the event log without divergence.
test('fretful feline: settlement identities replay identically across worlds', async () => {
  const program = await card('ven/fretful-feline');
  const [body] = program.abilities[0].body;
  const idsFor = () => {
    const f = fixture();
    f.kernel.addObject({ ref: { id: 'cat', zoneEntryId: 1 }, cardId: 'card:cat', name: 'cat', types: ['unit'], owner: 'A', controller: 'A', zone: 'board', location: { type: 'battlefield', id: 'battlefield-1' }, might: 5 });
    f.engine.pipeline.registerTrigger({
      id: 'cat-trigger-1',
      source: f.kernel.getObject('cat'),
      controller: 'A',
      spec: { at: 'object-readied', filter: { event: 'object-readied', object: { objectId: 'cat' } } },
      body: [body]
    });
    for (let round = 1; round <= 2; round += 1) {
      f.engine.commit({ type: 'ready', object: f.kernel.ref('cat') });
      f.engine.advance();
      resolveAll(f.engine);
    }
    return f.engine.layers.registry.snapshot().map(entry => entry.effect.id)
      .filter(id => id.includes('settlement'));
  };
  assert.deepEqual(idsFor(), idsFor());
});

// Rift Herald keeps every inspect argument inside Expr envelopes; the adapter
// must leave them intact so the linked pick source still resolves.
test('rift herald: inspect Expr envelopes pass through unchanged', async () => {
  const program = await card('unl/rift-herald');
  const body = program.abilities[0].body;
  const inspectInstruction = body.find(instruction => instruction.op === 'effect.inspect');
  assert.ok(inspectInstruction);
  const f = fixture();
  f.kernel.setPicks('rift-herald.top-three', [
    f.kernel.ref('A:deck:1'), f.kernel.ref('A:deck:2'), f.kernel.ref('A:deck:3')
  ]);
  const result = resolveChainBody(body.slice(0, 2), f.host.context(
    f.kernel.getObject('source'), 'A', 'chain-item-resolve'
  ));
  assert.deepEqual(result.results.map(entry => entry.result.status), ['executed', 'executed']);
  const linked = result.results[1].result.linkedValues;
  assert.equal(linked['rift-herald.looked-count'], 3);
  assert.deepEqual(linked['rift-herald.looked'], [
    { id: 'A:deck:1', zoneEntryId: 1 },
    { id: 'A:deck:2', zoneEntryId: 1 },
    { id: 'A:deck:3', zoneEntryId: 1 }
  ]);
});

// 359.3.e.5/e.6: a locked target that leaves the board is ignored, not forced.
// The production finalize surface (EG-FINALIZE) blocks the full ChainEngine
// path for this nested body, so the adapter path plus a stale locked target
// stands in for the removed chain item the engine would append.
test('kennen keeper of balance: mistargeted stun after the unit leaves is ignored', async () => {
  const program = await card('ven/kennen-keeper-of-balance');
  const [optIn] = program.abilities[1].body;
  const f = fixture();
  f.kernel.addObject({ ref: { id: 'enemy-unit', zoneEntryId: 1 }, cardId: 'card:enemy-unit', name: 'enemy-unit', types: ['unit'], owner: 'B', controller: 'B', zone: 'board', location: { type: 'battlefield', id: 'battlefield-1' }, might: 2 });
  const staleRef = f.kernel.ref('enemy-unit');
  f.kernel.perform({ type: 'return-to-hand', object: staleRef });
  assert.equal(f.kernel.object(staleRef), null);
  f.kernel.setTargets('kennen.play.unit', [staleRef]);
  f.answers.set('kennen.play.opt-in/optional', true);
  const result = resolveChainBody([optIn], f.host.context(f.kernel.getObject('source'), 'A', 'chain-item-resolve'));
  assert.equal(result.results.length, 3);
  assert.deepEqual(result.results.slice(0, 2).map(entry => ({ id: entry.id, status: entry.result.status })), [
    { id: 'kennen.play.pay', status: 'executed' },
    { id: 'kennen.play.stun', status: 'ignored' }
  ]);
  assert.equal(result.results[1].result.reason, 'mistargeted');
  assert.equal(f.kernel.player('A').energy, 18);
  assert.equal(f.kernel.objects.filter(object => object.zone === 'hand' && object.stunned).length, 0);
});

