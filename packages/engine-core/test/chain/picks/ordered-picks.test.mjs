import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAll } from '../helpers.mjs';
import { c, linked, source, resultPick, inspect, validated, setup, deck, requestOnResolve } from './helpers.mjs';

test('Finalize locks the actual top five; Resolve privately chooses one, reveals it, and moves it to hand', () => {
  const f = setup();
  const top = deck(f).slice(0, 5);
  const body = validated([
    inspect({ args: { ...inspect().args, choose: c(true), chooseCount: c({ min: 1, max: 1 }), choiceId: c('keep-one') } }),
    { id: 'reveal', op: 'effect.reveal', linkedTo: 'look', args: { pick: c('kept') }, picks: [resultPick('kept', 'look', 'inspected-pick')] },
    { id: 'take', op: 'effect.zone', linkedTo: 'reveal', args: { pick: c('shown'), to: c('hand') }, picks: [resultPick('shown', 'reveal', 'revealed')] }
  ]);
  f.engine.execute(f.draft('pick-one', { body }));
  const locked = f.engine.items[0].pickPlans[0].refs;
  assert.deepEqual(locked.map(ref => ref.id), top);
  assert.equal(f.engine.items[0].status, 'finalized');
  assert.equal(f.engine.pipeline.events.filter(event => ['cards-looked-at', 'card-revealed', 'became-target'].includes(event.timingPoint)).length, 0);
  const beforeEvents = f.engine.pipeline.events;
  const request = requestOnResolve(f);
  assert.equal(request.id, 'look/keep-one');
  assert.equal(request.visibility, 'chooser-only');
  assert.equal(request.chooser, 'A');
  assert.deepEqual(request.options, locked);
  assert.equal(request.min, 1); assert.equal(request.max, 1);
  assert.deepEqual(f.engine.pipeline.events, beforeEvents);
  assert.equal(f.kernel.linked('look.inspected-picked'), undefined);
  f.answers.set(request.id, [request.options[3]]);
  f.engine.pass('B');
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.kernel.getObject(top[3]).zone, 'hand');
  assert.deepEqual(f.kernel.linked('look.inspected-picked'), locked);
  assert.deepEqual(f.kernel.linked('reveal.revealed'), [locked[3]]);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === 'became-target').length, 0);
  assert.deepEqual(deck(f), [...top.filter(id => id !== top[3]), 'tail']);
});

test('inspect -> choice.order -> effect.order puts the five back on the bottom in the specified order', () => {
  const f = setup();
  const initial = deck(f), refs = f.kernel.zoneSlice('A', 'deck', 'top', 5).map(object => object.ref);
  f.engine.execute(f.draft('bottom', { body: validated([
    inspect(),
    { id: 'arrange', op: 'choice.order', args: { objects: linked('look', 'inspected-picked'), chooser: c('A'), visibility: c('chooser-only') } },
    { id: 'put-back', op: 'effect.order', linkedTo: 'arrange', args: { destination: c('bottom'), cardsPick: c('arranged'), chooseOrder: c(false) }, picks: [resultPick('arranged', 'arrange', 'value')] }
  ]) }));
  const request = requestOnResolve(f);
  assert.equal(request.type, 'order');
  assert.deepEqual(request.options, refs);
  f.answers.set(request.id, [refs[2], refs[4], refs[0], refs[3], refs[1]]);
  f.engine.pass('B');
  assert.deepEqual(deck(f), [initial[5], initial[2], initial[4], initial[0], initial[3], initial[1]]);
  assert.equal(f.kernel.linked('put-back.ordered'), 5);
});

test('locked source order survives a subsequent shuffle and new top card without taking replacements', () => {
  const f = setup();
  const locked = f.kernel.zoneSlice('A', 'deck', 'top', 5).map(object => object.ref);
  f.engine.execute(f.draft('look-later', { body: validated([inspect()]) }));
  assert.equal(f.engine.commit({ type: 'shuffle', player: 'A' }).status, 'done');
  assert.equal(f.engine.commit({ type: 'move-zone', object: f.kernel.ref('incoming'), to: 'deck-top' }).status, 'done');
  f.engine.advance();
  resolveAll(f.engine);
  assert.equal(deck(f)[0], 'incoming');
  assert.deepEqual(f.kernel.linked('look.inspected-picked'), locked);
  assert.equal(f.kernel.linked('look.inspected'), 5);
});

test('a departed and returned card has a new zone incarnation and cannot rejoin the locked slice', () => {
  const f = setup();
  const refs = f.kernel.zoneSlice('A', 'deck', 'top', 5).map(object => object.ref);
  f.engine.execute(f.draft('leave-return', { body: validated([inspect()]) }));
  assert.equal(f.engine.commit({ type: 'move-zone', object: refs[1], to: 'hand' }).status, 'done');
  assert.equal(f.engine.commit({ type: 'move-zone', object: f.kernel.ref(refs[1].id), to: 'deck-top' }).status, 'done');
  assert.notEqual(f.kernel.ref(refs[1].id).zoneEntryId, refs[1].zoneEntryId);
  f.engine.advance(); resolveAll(f.engine);
  assert.deepEqual(f.kernel.linked('look.inspected-picked'), refs.filter((_, index) => index !== 1));
  assert.equal(f.kernel.linked('look.inspected'), 4);
  assert.equal(f.kernel.player('A').score, 0);
  assert.equal(f.kernel.player('B').score, 0);
});

test('a mandatory one-card choice is not weakened when the entire locked slice leaves before Resolve', () => {
  const f = setup();
  f.engine.execute(f.draft('all-left', { body: validated([
    inspect({ args: { ...inspect().args, choose: c(true), chooseCount: c({ min: 1, max: 1 }) } }),
    { id: 'then-draw', op: 'effect.draw', linkedTo: 'look', args: { amount: c(1) } }
  ]) }));
  for (const ref of f.engine.items[0].pickPlans[0].refs) assert.equal(f.engine.commit({ type: 'move-zone', object: ref, to: 'trash' }).status, 'done');
  f.engine.advance(); resolveAll(f.engine);
  assert.equal(f.kernel.getObject('tail').zone, 'hand');
  assert.equal(f.kernel.linked('look.inspected-picked'), undefined);
  assert.equal(f.kernel.player('A').deckSize, 0);
});

test('reveal retains partial failure and links only the actual revealed objects when one locked card leaves', () => {
  const f = setup();
  const body = validated([
    { id: 'show', op: 'effect.reveal', args: { pick: c('top') }, picks: [source()] },
    { id: 'put-bottom', op: 'effect.order', linkedTo: 'show', args: { cardsPick: c('shown'), destination: c('bottom'), chooseOrder: c(false) }, picks: [resultPick('shown', 'show', 'revealed')] }
  ]);
  f.engine.execute(f.draft('show-remaining', { body }));
  const refs = f.engine.items[0].pickPlans[0].refs;
  assert.equal(f.engine.commit({ type: 'move-zone', object: refs[2], to: 'hand' }).status, 'done');
  f.engine.advance(); resolveAll(f.engine);
  assert.deepEqual(f.kernel.linked('show.revealed'), refs.filter((_, index) => index !== 2));
  assert.equal(f.kernel.linked('show.revealedCount'), 4);
  assert.equal(f.kernel.linked('put-bottom.ordered'), 4);
  assert.deepEqual(deck(f), ['tail', ...refs.filter((_, index) => index !== 2).map(ref => ref.id)]);
});

test('short and empty zones obey look as much as possible without changing the requested source count', () => {
  for (const count of [0, 2]) {
    const f = setup();
    assert.equal(f.engine.commit({ type: 'mill', player: 'A', amount: 6 - count }).status, 'done');
    f.engine.advance();
    const available = f.kernel.zoneSlice('A', 'deck', 'top').map(object => object.ref);
    f.engine.execute(f.draft('short', { body: validated([inspect()]) }));
    assert.deepEqual(f.engine.items[0].pickPlans[0].refs, available);
    resolveAll(f.engine);
    assert.deepEqual(f.kernel.linked('look.inspected-picked'), available);
    assert.equal(f.kernel.linked('look.inspected'), count);
    assert.equal(f.kernel.player('B').score, 0);
  }
});

test('bottom zone slices retain top-to-bottom relative order and isolate the selected player', () => {
  const f = setup();
  const refs = f.kernel.zoneSlice('B', 'deck', 'bottom', 2).map(object => object.ref);
  f.engine.execute(f.draft('other-bottom', { body: validated([
    { id: 'show', op: 'effect.reveal', args: { pick: c('bottom') }, picks: [source('bottom', 2, { zoneSlice: { player: c('B'), zone: 'deck', from: 'bottom', count: c(2) } })] }
  ]) }));
  assert.deepEqual(f.engine.items[0].pickPlans[0].refs, refs);
  resolveAll(f.engine);
  assert.deepEqual(f.kernel.linked('show.revealed'), refs);
  assert.deepEqual(deck(f), ['A:deck:3', 'A:deck:1', 'A:deck:4', 'A:deck:2', 'fifth', 'tail']);
});

test('Finalize failure rolls back locked plans together with payment and chain identity', () => {
  const f = setup({ energy: 1 });
  const draft = f.draft('pay-later', { body: validated([inspect()]), cost: { id: 'cost', cost: { energy: c(2) } } });
  assert.throws(() => f.engine.execute(draft), /[Pp]ay|[Cc]ost/);
  assert.equal(f.engine.items.length, 0);
  assert.equal(f.engine.commit({ type: 'gain-energy', player: 'A', amount: 2 }).status, 'done');
  assert.equal(f.engine.commit({ type: 'order-top', player: 'A', objects: [f.kernel.ref('tail')] }).status, 'done');
  f.engine.advance();
  f.engine.execute(draft);
  assert.equal(f.engine.items[0].pickPlans[0].refs[0].id, 'tail');
  resolveAll(f.engine);
  assert.equal(f.kernel.linked('look.inspected-picked')[0].id, 'tail');
});

test('order responses must be complete permutations; rejected responses roll back Resolve before a correct retry', () => {
  const f = setup();
  f.engine.execute(f.draft('checked-order', { body: validated([
    { id: 'put-back', op: 'effect.order', args: { destination: c('bottom'), cardsPick: c('top') }, picks: [source()] }
  ]) }));
  const request = requestOnResolve(f), before = deck(f);
  f.answers.set(request.id, [request.options[0]]);
  assert.throws(() => f.engine.pass('B'), /exact permutation/);
  assert.deepEqual(deck(f), before);
  assert.equal(f.engine.priority, 'B');
  f.answers.set(request.id, [...request.options].reverse());
  f.engine.pass('B');
  assert.deepEqual(deck(f), ['tail', ...before.slice(0, 5).reverse()]);
});

test('Predict five links the actual recycle receipt and orders only the remainder after a changed deck top', () => {
  const f = setup();
  const refs = f.kernel.zoneSlice('A', 'deck', 'top', 5).map(object => object.ref);
  f.engine.execute(f.draft('predict-five', { body: validated([
    inspect({ args: { ...inspect().args, choose: c(true), chooseCount: c({ min: 0, max: 5 }), choiceId: c('recycle-any') } }),
    { id: 'recycle', op: 'effect.recycle', linkedTo: 'look', args: { objects: linked('look', 'inspected-pick') } },
    { id: 'put-back', op: 'effect.order', linkedTo: 'recycle', args: { cardsPick: c('rest'), destination: c('top') }, picks: [{ ...resultPick('rest', 'look', 'inspected-picked'), exclude: linked('recycle', 'recycled') }] }
  ]) }));
  assert.equal(f.engine.commit({ type: 'move-zone', object: f.kernel.ref('incoming'), to: 'deck-top' }).status, 'done');
  f.engine.advance();
  const select = requestOnResolve(f);
  f.answers.set(select.id, [refs[1], refs[3]]);
  let order;
  assert.throws(() => f.engine.pass('B'), error => { order = error.request; return Boolean(order); });
  const rest = [refs[0], refs[2], refs[4]];
  assert.equal(order.type, 'order');
  assert.deepEqual(order.options, rest);
  // The failed Resolve has rolled back its earlier recycle actions too.
  assert.deepEqual(f.kernel.zoneSlice('A', 'deck', 'top').map(object => object.ref), [f.kernel.ref('incoming'), ...refs, f.kernel.ref('tail')]);
  f.answers.set(order.id, [rest[2], rest[0], rest[1]]);
  f.engine.pass('B');
  assert.deepEqual(f.kernel.linked('recycle.recycled'), [refs[1], refs[3]]);
  assert.equal(f.kernel.linked('put-back.ordered'), 3);
  assert.deepEqual(deck(f), [rest[2].id, rest[0].id, rest[1].id, 'incoming', 'tail', refs[1].id, refs[3].id]);
});

test('linked sources use the current chain item result rather than a previous resolution alias', () => {
  const f = setup();
  const show = { id: 'show', op: 'effect.reveal', args: { pick: c('seen') }, picks: [resultPick('seen', 'look', 'inspected-picked')] };
  f.engine.execute(f.draft('first', { body: validated([inspect(), show]) })); resolveAll(f.engine);
  const shown = f.engine.pipeline.events.filter(event => event.timingPoint === 'card-revealed').length;
  assert.equal(shown, 5);
  f.engine.execute(f.draft('second', { body: validated([inspect({ condition: { kind: 'never' } }), show]) })); resolveAll(f.engine);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === 'card-revealed').length, shown);
});

test('an invalid raw zone source is rejected atomically rather than treated as an empty binding', () => {
  const f = setup(), before = deck(f);
  assert.throws(() => f.engine.execute(f.draft('invalid-source', { body: [inspect({ picks: [{ ...source(), zoneSlice: null }] })] })), /invalid zone slice/);
  assert.equal(f.engine.items.length, 0);
  assert.deepEqual(deck(f), before);
});

test('a linked pick is the same binding in object selectors, conditions, and primitive arguments', () => {
  const f = setup();
  const top = deck(f)[0];
  f.engine.execute(f.draft('selectors', { body: validated([
    inspect({ args: { ...inspect().args, choose: c(true), chooseCount: c({ min: 1, max: 1 }), choiceId: c('one') } }),
    { id: 'read', op: 'condition.value', args: { value: { kind: 'object-property', object: { pick: 'chosen' }, property: 'name' } }, picks: [resultPick('chosen', 'look', 'inspected-pick')] },
    { id: 'show', op: 'effect.reveal', args: { pick: c('chosen') }, condition: { kind: 'compare', left: { kind: 'object-property', object: { pick: 'chosen' }, property: 'name' }, operator: 'eq', right: linked('read', 'value') } }
  ]) }));
  const request = requestOnResolve(f);
  f.answers.set(request.id, [request.options[0]]);
  f.engine.pass('B');
  assert.equal(f.kernel.linked('read.value'), f.kernel.getObject(top).name);
  assert.deepEqual(f.kernel.linked('show.revealed').map(ref => ref.id), [top]);
});

test('a forward pick selector cannot borrow its producer result from a previous chain item', () => {
  const f = setup();
  const show = { id: 'show', op: 'effect.reveal', args: { pick: c('seen') }, picks: [resultPick('seen', 'look', 'inspected-picked')] };
  f.engine.execute(f.draft('prior', { body: validated([inspect(), show]) })); resolveAll(f.engine);
  f.engine.execute(f.draft('forward', { body: validated([
    { id: 'look', op: 'condition.value', args: { value: { kind: 'object-property', object: { pick: 'seen' }, property: 'name' } } }, show
  ]) })); resolveAll(f.engine);
  assert.equal(f.kernel.linked('look.value'), undefined);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === 'card-revealed').length, 5);
});

test('a linked source inside repeat binds to the current iteration after the previous one moved the cards', () => {
  const f = setup();
  const body = validated([{ id: 'twice', op: 'repeat', args: { count: c(2), body: c([
    { id: 'show', op: 'effect.reveal', args: { zone: c('hand') } },
    { id: 'move', op: 'effect.zone', linkedTo: 'show', args: { pick: c('seen'), to: c('trash') }, picks: [resultPick('seen', 'show', 'revealed')] }
  ]) } }]);
  f.engine.execute(f.draft('repeat-links', { body })); resolveAll(f.engine);
  assert.equal(f.kernel.getObject('incoming').zone, 'trash');
  assert.equal(f.kernel.linked('twice/0/show.revealedCount'), 1);
  assert.equal(f.kernel.linked('twice/1/show.revealedCount'), 0);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === 'object-leaves-hand' && event.object?.ref.id === 'incoming').length, 1);
});
