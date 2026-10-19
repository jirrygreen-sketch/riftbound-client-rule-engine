import assert from 'node:assert/strict';
import test from 'node:test';
import { AwaitChoice } from '../../dist/effects/contract.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { ChainEngine } from '../../dist/chain/engine.js';
import { TurnFlow } from '../../dist/turn/flow.js';
import { createProgramBinding } from '../../dist/programs/index.js';
import { createEngineStaticBinder } from '../../dist/programs/statics.js';
import { projectAbilityGrantInstruction, projectStaticAbilityGrant, resolveAbilityGrants } from '../../dist/programs/ability-grants/index.js';
import { bindGrantedAbility } from '../../dist/programs/ability-grants/bind.js';
import { expandEffectiveKeywords } from '../../dist/programs/keyword-grants.js';
import dominus from '../../../card-dsl/dist/cards/ven/dominus.js';
import lastStand from '../../../card-dsl/dist/cards/ogn/last-stand.js';

const c = value => ({ kind: 'constant', value });
const at = id => ({ type: 'battlefield', id });
const program = (id, abilities) => ({ canonicalCardId: id, rulesetVersion: 'core-1.5', status: 'executable', sourceText: 'grant regression', abilities });
const ready = { kind: 'activated', timing: 'action', cost: { kind: 'activated', energy: c(1) },
  body: [{ id: 'granted-ready', op: 'effect.ready', args: { objects: c({ kind: 'source' }) } }] };
const grant = (ability = ready, extra = {}) => ({ id: 'grant', op: 'continuous.grant-ability',
  args: { ability: c(ability), ...extra } });

function runtime(builder, programs = [], turns = false) {
  const kernel = builder.build(), answers = new Map();
  const choose = request => {
    if (answers.has(request.id)) return answers.get(request.id);
    for (const [key, answer] of answers) if (request.id.endsWith(`/${key}`)) return answer;
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) return [...request.options];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects, perform: action => kernel.perform(action), choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  // Admit unchanged IR only for the isolated engine test; production status is
  // asserted below and the catalog program is never edited or promoted.
  const binding = createProgramBinding({ cardPrograms: programs.map(item => ({ ...item, status: 'executable', judgeReason: undefined })) });
  const flow = turns ? new TurnFlow({ host, player: id => kernel.player(id), turnOrder: ['A', 'B'],
    battlefields: [{ id: 'one', controller: null }, { id: 'two', controller: null }], describePlay: binding.describePlay }) : undefined;
  const engine = flow?.chain ?? new ChainEngine({ host, turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', describePlay: binding.describePlay,
    cleanup: current => {
      current.layers.setObjects(kernel.objects);
      let changed = false;
      for (const object of current.layers.evaluateAll()) if (object.zone === 'board' && object.types.includes('unit') &&
        object.might !== null && (object.might <= 0 || object.damage >= object.might)) {
        assert.equal(current.commit({ type: 'kill', object: object.ref }).status, 'done');
        changed = true;
      }
      return changed;
    } });
  if (programs.length) binding.attachLifecycle(engine, error => { throw error; });
  const snapshot = id => { engine.layers.setObjects(kernel.objects); return engine.layers.snapshot(kernel.ref(id)); };
  const context = source => bindResolveContext(kernel, { source, controller: source.controller, choose,
    object: ref => engine.layers.snapshot(ref), query: filter => host.context(source, source.controller, 'cleanup-start').query(filter) });
  const effective = (id, printed = [], scope) => resolveAbilityGrants(snapshot(id), printed, engine.layers.registry, context, scope);
  let sequence = 0;
  const submit = (body, source = 'source') => {
    const object = snapshot(source);
    engine.execute({ id: `grant-case:${++sequence}`, source: object, controller: object.controller, kind: 'activated', speed: 'action', body });
  };
  const settle = () => {
    engine.advance();
    for (let step = 0; engine.items.length; step++) {
      assert.ok(step < 40, 'real priority passes settle the chain');
      engine.pass(engine.priority);
    }
  };
  const resolve = (body, source) => { submit(body, source); settle(); };
  const enter = id => {
    const location = kernel.getObject(id).location;
    assert.equal(engine.commit({ type: 'move-zone', object: kernel.ref(id), to: 'chain' }).status, 'done');
    assert.equal(engine.commit({ type: 'move-zone', object: kernel.ref(id), to: 'battlefield', location }).status, 'done');
    engine.advance();
  };
  return { kernel, answers, engine, flow, binding, snapshot, effective, submit, settle, resolve, enter };
}
const fixture = () => runtime(world().player('A', { energy: 10 }).unit('source', { cardId: 'source', might: 3, energy: null, power: null }));

test('effective keyword expansion preserves printed costs and independent Equip identities', () => {
  const source = world().unit('gear', { cardId: 'gear', energy: null, power: null }).build().getObject('gear');
  const result = expandEffectiveKeywords(source, [{ kind: 'grant', keywords: [
    { id: 'Equip', params: { cost: { kind: 'activated', energy: c(2) } } },
    { id: 'Equip', params: { cost: { kind: 'activated', energy: c(3) } } },
    { id: 'Empower', params: { cost: { kind: 'activated', energy: c(4) } } },
  ] }]);
  assert.deepEqual(result.abilities.map(ability => ability.cost.energy.value), [2, 3, 4]);
  const targets = result.abilities.slice(0, 2).map(ability => ability.body[0].targets[0].id);
  assert.equal(new Set(targets).size, 2, 'separate instances keep independent Finalize and link identities');
  assert.equal(source.energy, null);
  assert.equal(source.power, null);
});

test('static and instruction grant projections use the live source as the unique installer', () => {
  const aura = program('aura', [{ kind: 'static', effect: { kind: 'continuous.grant-ability',
    filter: { type: 'unit', controller: 'self', sameLocationAs: 'self' }, ability: ready } }]);
  const f = runtime(world().battlefield('source', { cardId: 'aura', types: ['battlefield'], location: at('one') })
    .unit('hero', { cardId: 'hero', location: at('one') }));
  f.enter('source');
  const source = f.snapshot('source');
  const objects = f.engine.layers.evaluateAll();
  const grantSource = { ref: source.ref, snapshot: source, controller: source.controller,
    object: ref => f.engine.layers.snapshot(ref),
    query: filter => objects.filter(object => (filter.objectId === undefined || object.ref.id === filter.objectId) &&
      (filter.type === undefined || object.types.includes(filter.type))) };
  const staticEffects = projectStaticAbilityGrant(grantSource, aura.abilities[0]);
  assert.equal(staticEffects.length, 1);
  assert.deepEqual(staticEffects[0].filter.objectId, 'hero');
  const instruction = grant(ready, { filter: c({ type: 'unit', zone: 'board', objectId: 'hero' }) });
  const instructionEffects = projectAbilityGrantInstruction(grantSource, instruction);
  assert.equal(instructionEffects.length, 1);
  assert.deepEqual(instructionEffects[0].effect.abilities, [ready]);
  assert.notEqual(staticEffects[0].id, instructionEffects[0].id);
});

test('a default ChainEngine executes the unchanged Dominus IR and retains its entire granted ability', () => {
  const f = runtime(world().player('A', { energy: 10, power: ['Fury', 'Calm'] })
    .hand('spell', { cardId: dominus.canonicalCardId, types: ['spell'], energy: 4, might: null, power: null })
    .unit('hero', { cardId: 'hero', might: 3, exhausted: true, power: null }), [dominus]);
  assert.equal(f.engine.commit({ type: 'play', player: 'A', object: f.kernel.ref('spell') }).status, 'done');
  f.settle();
  assert.equal(f.snapshot('hero').might, 6);
  const original = dominus.abilities.find(ability => ability.kind === 'play').body.find(instruction => instruction.op === 'continuous.grant-ability').args.ability.value;
  const effective = f.effective('hero');
  assert.deepEqual(effective.abilities, [original]);
  assert.equal(f.kernel.getObject('spell').zone, 'trash', 'a resolved grant outlives its granting spell');
  assert.equal(f.snapshot('hero').power, null);
  // The lifecycle owner's requested connection is represented explicitly here:
  // feed the computed abilities into the existing production program consumer.
  const binding = createProgramBinding({ cardPrograms: [program('hero', effective.abilities)] });
  f.engine.execute(binding.describeActivate(f.snapshot('hero'), 'A'));
  f.settle();
  assert.equal(f.snapshot('hero').exhausted, false);
  assert.equal(f.kernel.player('A').power.length, 0, 'the original two any-domain Power costs are paid');
  assert.throws(() => { f.engine.execute(binding.describeActivate(f.snapshot('hero'), 'A')); f.settle(); }, /power|pay|cost/i);
  assert.equal(f.snapshot('hero').exhausted, false);
  assert.equal(dominus.status, 'judge-required');
});

test('multiple full ability grants keep independent registrations and revoke independently', () => {
  const f = fixture();
  f.resolve([grant(ready, { duration: c('this-combat'), settlementId: c('first') })]);
  f.resolve([grant(ready, { duration: c('permanent'), settlementId: c('second') })]);
  assert.deepEqual(f.effective('source').abilities, [ready, ready]);
  assert.equal(new Set(f.effective('source').entries.map(entry => entry.id)).size, 2);
  const [first] = f.engine.layers.registry.list();
  assert.equal(f.engine.layers.removeContinuous(first.effect.id), true);
  assert.deepEqual(f.effective('source').abilities, [ready]);
  assert.equal(f.snapshot('source').energy, null);
  assert.equal(f.snapshot('source').power, null);
});

test('same-resolution multi-target grants receive distinct stable registration ids', () => {
  const f = runtime(world().unit('source', { cardId: 'source' }).unit('other', { cardId: 'other' }));
  f.resolve([{ ...grant(ready, { filter: c({ type: 'unit', zone: 'board' }) }), id: 'all-units' }]);
  const ids = f.engine.layers.registry.list().map(entry => entry.effect.id);
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2);
  assert.equal(new Set(ids).size, ids.length);
});

test('valued keyword grants sum and separate keyword entries keep identity when another grant is revoked', () => {
  const f = fixture();
  const equip = amount => ({ kind: 'keyword', keyword: 'equip', params: { cost: { kind: 'activated', energy: c(amount) } } });
  f.resolve([grant(equip(2), { settlementId: c('equip-first') }),
    { ...grant({ kind: 'keyword', keyword: 'assault', value: 2 }), id: 'assault-first' }]);
  f.resolve([grant(equip(3), { settlementId: c('equip-second') }),
    { ...grant({ kind: 'keyword', keyword: 'assault', value: 3 }, { settlementId: c('assault-second') }), id: 'assault-second' }]);
  const before = f.effective('source');
  assert.equal(before.keywords.find(keyword => keyword.id === 'Assault').value, 5);
  const survivor = before.entries.find(entry => entry.ability.kind === 'activated' && entry.ability.cost.energy.value === 3);
  const first = f.engine.layers.registry.list().find(entry => entry.effect.id.includes('equip-first'));
  f.engine.layers.removeContinuous(first.effect.id);
  const after = f.effective('source');
  assert.equal(after.keywords.find(keyword => keyword.id === 'Assault').value, 5);
  assert.deepEqual(after.entries.find(entry => entry.ability.kind === 'activated'), survivor);
});

test('original Last Stand IR grants Temporary and the production trigger route kills at its controller Beginning', () => {
  const f = runtime(world().player('A').player('B')
    .hand('spell', { cardId: lastStand.canonicalCardId, types: ['spell'], energy: 3, might: null, power: ['Calm'] })
    .unit('hero', { cardId: 'hero', might: 3, power: null })
    .deck('draw-a').deck('draw-a-next').deck('draw-b', { owner: 'B' }), [lastStand], true);
  f.flow.start();
  f.answers.set('target:last-stand.unit', [f.kernel.ref('hero')]);
  assert.equal(f.engine.commit({ type: 'gain-energy', player: 'A', amount: 3 }).status, 'done');
  assert.equal(f.engine.commit({ type: 'gain-power', player: 'A', power: ['Calm'] }).status, 'done');
  assert.equal(f.engine.commit({ type: 'play', player: 'A', object: f.kernel.ref('spell') }).status, 'done');
  f.settle();
  assert.equal(f.kernel.player('A').energy, 0);
  assert.deepEqual(f.kernel.player('A').power, []);
  assert.equal(f.snapshot('hero').might, 6);
  const temporary = f.effective('hero').entries.find(entry => entry.ability.kind === 'triggered');
  const handle = bindGrantedAbility(f.engine, f.snapshot('hero'), temporary, createEngineStaticBinder(f.engine));
  f.flow.pass('A');
  assert.equal(f.flow.turnPlayer, 'B');
  assert.equal(f.snapshot('hero').might, 3);
  f.flow.pass('B');
  for (let step = 0; f.engine.items.length; step++) {
    assert.ok(step < 20);
    f.flow.pass(f.engine.priority);
  }
  assert.equal(f.kernel.getObject('hero').zone, 'trash');
  handle.unbind();
  assert.equal(lastStand.status, 'judge-required');
});

test('the original Dominus target lost after Finalize receives neither a Might change nor an ability', () => {
  const f = runtime(world().player('A', { energy: 10 })
    .hand('spell', { cardId: dominus.canonicalCardId, types: ['spell'], energy: 4, might: null, power: null })
    .unit('hero', { cardId: 'hero', might: 3 }), [dominus, program('hero', [])]);
  assert.equal(f.engine.commit({ type: 'play', player: 'A', object: f.kernel.ref('spell') }).status, 'done');
  f.engine.advance();
  assert.equal(f.engine.commit({ type: 'kill', object: f.kernel.ref('hero') }).status, 'done');
  f.settle();
  assert.equal(f.kernel.getObject('spell').zone, 'trash');
  assert.deepEqual(f.engine.layers.registry.list(), []);
  f.enter('hero');
  assert.equal(f.snapshot('hero').might, 3);
  assert.deepEqual(f.effective('hero').abilities, []);
});

test('full ability duration expires after the real complete TurnFlow ending sequence', () => {
  const f = runtime(world().player('A').player('B').unit('source', { cardId: 'source', might: 3, power: null })
    .deck('draw-a').deck('draw-b', { owner: 'B' }), [], true);
  f.flow.start();
  assert.equal(f.flow.phase, 'main');
  f.resolve([grant(ready, { duration: c('this-turn') })]);
  assert.equal(f.effective('source').abilities.length, 1);
  f.flow.pass('A');
  assert.equal(f.flow.turnPlayer, 'B');
  assert.equal(f.flow.phase, 'main');
  assert.deepEqual(f.effective('source').abilities, []);
});

test('target invalidation and a source incarnation change revoke without affecting a returned object', () => {
  const f = runtime(world().unit('source', { cardId: 'source' }).unit('hero', { cardId: 'hero' }));
  const body = [grant(ready, { target: c('hero'), duration: c('while-source-in-zone') })];
  body[0].targets = [{ id: 'hero', filter: { objectId: 'hero', zone: 'board' }, min: 1, max: 1 }];
  f.resolve(body);
  assert.deepEqual(f.effective('hero').abilities, [ready]);
  assert.equal(f.engine.commit({ type: 'kill', object: f.kernel.ref('source') }).status, 'done');
  assert.deepEqual(f.effective('hero').abilities, []);
  f.enter('source');
  assert.deepEqual(f.effective('hero').abilities, []);
  f.submit(body);
  f.engine.advance();
  assert.equal(f.engine.commit({ type: 'kill', object: f.kernel.ref('hero') }).status, 'done');
  f.settle();
  f.enter('hero');
  assert.deepEqual(f.effective('hero').abilities, [], 'locked old target never follows the same id into a new incarnation');
});

test('an awaited choice rolls back a registered ability and its settlement identity before retry', () => {
  const f = fixture();
  f.submit([grant(), { id: 'choose-after-grant', op: 'choice.optional', args: {
    body: c([{ id: 'reward', op: 'effect.xp', args: { amount: c(1) } }]),
  } }]);
  let request;
  assert.throws(f.settle, error => { request = error.request; return error instanceof AwaitChoice; });
  assert.deepEqual(f.effective('source').abilities, []);
  assert.deepEqual(f.engine.layers.registry.list(), []);
  f.answers.set(request.id, true);
  f.settle();
  assert.deepEqual(f.effective('source').abilities, [ready]);
  assert.equal(f.kernel.player('A').xp, 1);
  assert.match(f.engine.layers.registry.list()[0].effect.id, /granted/);
});

test('invalid chosen refs and invalid full IR reject atomically after an earlier grant', () => {
  const f = fixture();
  f.answers.set('grant-choice', [{ id: 'nonexistent', zoneEntryId: 1 }]);
  f.submit([grant(), { ...grant(ready, { choose: c({ id: 'grant-choice', filter: { type: 'unit', zone: 'board' }, min: 1, max: 1 }) }), id: 'second' }]);
  assert.throws(f.settle, /Invalid ability choice answer/);
  assert.deepEqual(f.engine.layers.registry.list(), []);
  // A separate fixture avoids reusing the deliberately rejected pending chain.
  const bad = fixture();
  bad.submit([grant(), { ...grant({ kind: 'activated', timing: 'action', body: [] }), id: 'invalid' }]);
  assert.throws(bad.settle, /Invalid granted ability/);
  assert.deepEqual(bad.engine.layers.registry.list(), []);
});

test('default static lifecycle registrations follow conditions, source movement and control', () => {
  const aura = program('aura', [{ kind: 'static', condition: {
    kind: 'compare', left: { kind: 'object-property', object: 'self', property: 'exhausted' }, operator: 'eq', right: c(false),
  }, effect: { kind: 'continuous.grant-ability', layer: 'ability',
    filter: { type: 'unit', controller: 'self', sameLocationAs: 'self' }, ability: ready } }]);
  const f = runtime(world().unit('source', { cardId: 'aura', location: at('one') })
    .unit('hero', { cardId: 'hero', location: at('one') })
    .unit('enemy', { cardId: 'enemy', owner: 'B', location: at('one') }), [aura]);
  f.enter('source');
  assert.deepEqual(f.effective('hero').abilities, [ready]);
  assert.deepEqual(f.effective('enemy').abilities, []);
  assert.equal(f.engine.commit({ type: 'exhaust', object: f.kernel.ref('source') }).status, 'done');
  assert.deepEqual(f.effective('hero').abilities, []);
  assert.equal(f.engine.commit({ type: 'ready', object: f.kernel.ref('source') }).status, 'done');
  assert.deepEqual(f.effective('hero').abilities, [ready]);
  assert.equal(f.engine.commit({ type: 'move-location', object: f.kernel.ref('source'), to: at('two') }).status, 'done');
  assert.deepEqual(f.effective('hero').abilities, []);
  assert.equal(f.engine.commit({ type: 'move-location', object: f.kernel.ref('source'), to: at('one') }).status, 'done');
  assert.equal(f.engine.commit({ type: 'take-control', object: f.kernel.ref('source'), player: 'B' }).status, 'done');
  assert.deepEqual(f.effective('hero').abilities, []);
  assert.deepEqual(f.effective('enemy').abilities, [ready]);
  assert.equal(f.engine.commit({ type: 'kill', object: f.kernel.ref('source') }).status, 'done');
  assert.deepEqual(f.effective('enemy').abilities, []);
});

test('scoped ignoring keeps Tank characteristics and affects only the designated player and procedure', () => {
  const f = fixture();
  f.resolve([grant({ kind: 'keyword', keyword: 'tank' }), { id: 'ignore-tank', op: 'continuous.ignore-ability', args: {
    ignores: c(['Tank']), operation: c('combat-damage-assignment'), players: c('controller'),
  } }]);
  const normal = f.effective('source');
  assert.deepEqual(normal.keywords, [{ id: 'Tank' }]);
  assert.equal(normal.abilities.length, 1);
  const own = f.effective('source', [], { operation: 'combat-damage-assignment', player: 'A' });
  assert.deepEqual(own.keywords, normal.keywords);
  assert.deepEqual(own.abilities, []);
  assert.equal(f.effective('source', [], { operation: 'combat-damage-assignment', player: 'B' }).abilities.length, 1);
  assert.equal(f.effective('source', [], { operation: 'move', player: 'A' }).abilities.length, 1);
});

test('a resolved ignore scope retains its designated player when the source changes controller and leaves', () => {
  const f = runtime(world().unit('source', { cardId: 'source' }).unit('hero', { cardId: 'hero' }));
  f.resolve([grant({ kind: 'keyword', keyword: 'tank' }, { filter: c({ objectId: 'hero', zone: 'board' }) }),
    { id: 'ignore', op: 'continuous.ignore-ability', args: { filter: c({ objectId: 'hero', zone: 'board' }),
      ignores: c(['Tank']), operation: c('combat-damage-assignment'), players: c('controller') } }]);
  assert.equal(f.engine.commit({ type: 'take-control', object: f.kernel.ref('source'), player: 'B' }).status, 'done');
  assert.equal(f.effective('hero', [], { operation: 'combat-damage-assignment', player: 'A' }).abilities.length, 0);
  assert.equal(f.effective('hero', [], { operation: 'combat-damage-assignment', player: 'B' }).abilities.length, 1);
  assert.equal(f.engine.commit({ type: 'kill', object: f.kernel.ref('source') }).status, 'done');
  assert.equal(f.effective('hero', [], { operation: 'combat-damage-assignment', player: 'A' }).abilities.length, 0);
  assert.deepEqual(f.effective('hero').keywords, [{ id: 'Tank' }]);
});

test('derived Temporary registers and unregisters through the existing trigger and chain routes', () => {
  const f = runtime(world().player('A').player('B').unit('source', { cardId: 'source', might: 3 })
    .deck('draw-a').deck('draw-b', { owner: 'B' }), [], true);
  f.flow.start();
  f.resolve([grant({ kind: 'keyword', keyword: 'temporary' })]);
  const [entry] = f.effective('source').entries;
  const handle = bindGrantedAbility(f.engine, f.snapshot('source'), entry, createEngineStaticBinder(f.engine));
  assert.equal(f.engine.commit({ type: 'take-control', object: f.kernel.ref('source'), player: 'B' }).status, 'done');
  assert.equal(f.kernel.getObject('source').zone, 'board');
  f.flow.pass('A');
  assert.equal(f.engine.items.length, 1);
  for (let step = 0; f.engine.items.length; step++) {
    assert.ok(step < 20);
    f.flow.pass(f.engine.priority);
  }
  assert.equal(f.kernel.getObject('source').zone, 'trash');
  handle.unbind();
  assert.equal(f.engine.pipeline.checkpoint().triggers.has(entry.id), false);
});
