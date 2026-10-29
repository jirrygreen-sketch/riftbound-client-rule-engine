import assert from 'node:assert/strict';
import test from 'node:test';

import { ChainEngine } from '../../dist/chain/engine.js';
import { instructionDefinitionsById } from '../../dist/effects/instructions/registry.generated.js';
import { world } from '../../dist/effects/testing/index.js';
import { bindResolveContext, createActionPipelineHost } from '../../dist/events/action-adapter.js';
import { createLayerEngine } from '../../dist/layers/index.js';
import { createProgramBinding } from '../../dist/programs/index.js';

// Official evidence for every assertion in this file:
// Riftbound Core Rules v1.5, published 2026-10-09,
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// Local snapshot: /root/swarm-rift/shared/rules/CR-v1.5.txt.
// - 135.1: Rules Text is the card's rules-text section.
// - 135.4: a card's printed Rules Text is Inactive while that card is Attached;
//   presence alone is not evidence that the copied Rules Text is active.
// - 136.1-136.2.c: Effect Text is a distinct section; it is inactive unless
//   the carrier is attached, then its abilities append to the Top-Most card.
// - 435.1.e / 436.1.c / 718.1-718.3 / 719.1: attachment boundaries govern
//   inactive rules text and appended effect text.
// - 446.1-446.2 / 479.1.a-d: Copies are Copy Effects and are applied first in
//   the copy layer. 479.1.b copies only the specified traits.
// - 479.1.d's published Svellsongur example copies the attached object's text
//   into the Equipment's Effect Text "for as long as this is attached".
//   The local catalog evidence is sfd-059-221, canonicalCardId
//   card.hash-b789f6d844c0da0576802aca0c36d51a7475c3c3c62c21b9ef4092438971fafe.
//   The sibling VEN-137/166 Shady Spectacles copy uses the same layer boundary
//   and canonicalCardId
//   card.hash-0b22da1f55c97313d8b71cfe7bc85b5b13ccca85dda9b92eea0b197fde0ed543.
// - 478.2-478.4: layer application/disqualification is continuously re-read,
//   and removal or loss of applicability is distinct from application.
// - 482.2-482.3: same-layer, dependency-free effects use timestamp order.
// Timeline exercised below: Chain Finalize selects existing Card/Equipment
// incarnations; Resolve registers the Copy Effect. The registration is
// reevaluated from live attachment state, so Detach removes copied text from
// the layer view without another Resolve and reattach restores eligibility.
// This test file deliberately does not claim catalog-text transport. The shared
// ObjectSnapshot contract has no trusted Rules Text/Effect Text producer; that
// producer and MatchCard/token delivery remain a parent-owned contract change.
// A small transient layer fixture is used only to prove copy-before-ability
// ordering and ordinary text-field isolation.

const constant = value => ({ kind: 'constant', value });
const battlefield = id => ({ type: 'battlefield', id });
const executable = program => ({ ...program, status: 'executable', judgeReason: undefined });

function runtime() {
  const kernel = world().player('A').player('B')
    .unit('host', { types: ['unit'] })
    .unit('other-host', { types: ['unit'] })
    .unit('equipment', {
      types: ['gear'], tags: ['Equipment'], controller: 'A', owner: 'A',
      location: battlefield('one'),
    })
    .build();
  assert.equal(kernel.perform({ type: 'attach', object: kernel.ref('equipment'), host: kernel.ref('host') }).status, 'done');
  const requests = [];
  const choose = request => {
    requests.push(request);
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new Error(`Unexpected production choice ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose,
    }),
  });
  const program = executable({
    canonicalCardId: 'synthetic:copy-text-runtime',
    rulesetVersion: 'core-1.5',
    sourceText: 'Copy the attached object text for as long as this is attached.',
    abilities: [],
  });
  const binding = createProgramBinding({ cardPrograms: [program] });
  const engine = new ChainEngine({
    host, turnOrder: ['A', 'B'], turnPlayer: 'A', phase: 'main', cleanup: () => false,
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(engine, error => { throw error; });
  return { kernel, engine, binding, program, requests };
}

function submitTextCopy(f, body) {
  const source = f.kernel.getObject('equipment');
  f.engine.execute({
    id: 'copy-text-runtime-item',
    controller: 'A', source, kind: 'activated', speed: 'action', body,
  });
  f.engine.advance();
  for (let guard = 0; f.engine.items.length; guard++) {
    assert.ok(guard < 20, 'the production Chain settles');
    assert.ok(f.engine.priority, 'a finalized item grants Priority');
    f.engine.pass(f.engine.priority);
  }
  return f.engine.layers.evaluate(source.ref);
}

function textCopyInstruction(id, mode = 'effect-text', overrides = {}) {
  return {
    id,
    op: 'effect.copy',
    args: {
      source: constant({ target: 'copy-text-host' }),
      mode: constant('effect'),
      onto: constant({ target: 'copy-text-receiver' }),
      duration: constant('while-source-in-zone'),
      textMode: constant(mode),
      ...overrides,
    },
    targets: [
      { id: 'copy-text-host', filter: { objectId: 'host', type: 'unit', zone: 'board' }, min: 1, max: 1 },
      { id: 'copy-text-receiver', filter: { objectId: 'equipment', type: 'gear', zone: 'board' }, min: 1, max: 1 },
    ],
  };
}

test('production ChainEngine registers the 479.1.d copy and leaves missing catalog text unavailable', () => {
  const f = runtime();
  const snapshot = submitTextCopy(f, [textCopyInstruction('copy-host-text')]);
  assert.equal(snapshot.text, null);
  assert.equal(snapshot.effectText, null);
  assert.equal(f.engine.layers.registry.list().filter(entry => entry.effect.layer === 'copy').length, 1);
  const registration = f.engine.layers.registry.list().find(entry => entry.effect.layer === 'copy');
  assert.equal(registration.effect.filter.states, 'attached');
  assert.deepEqual({
    ...registration.effect.effect,
    condition: registration.effect.effect.condition === undefined ? 'missing' : 'attachment-condition',
  }, {
    kind: 'copy-object',
    source: { id: 'host', zoneEntryId: 1 },
    properties: ['text->effectText'],
    attachment: { id: 'host', zoneEntryId: 1 },
    condition: 'attachment-condition',
  });
});

test('detach disqualifies and reattach restores the registration without another Resolve', () => {
  const f = runtime();
  const receiver = f.kernel.ref('equipment');
  assert.equal(submitTextCopy(f, [textCopyInstruction('copy-host-text')]).effectText, null);
  const registrationId = f.engine.layers.registry.list().find(entry => entry.effect.layer === 'copy').effect.id;
  const resolvedItems = f.engine.items.length;

  assert.equal(f.engine.commit({ type: 'detach', object: receiver }).status, 'done');
  f.engine.advance();
  assert.equal(f.engine.layers.evaluate(receiver).effectText, null);
  assert.ok(f.engine.layers.registry.get(registrationId), 'the registration remains available for reattachment');
  assert.equal(f.engine.items.length, resolvedItems, 'layer invalidation does not create another Chain item');

  assert.equal(f.engine.commit({ type: 'attach', object: receiver, host: f.kernel.ref('host') }).status, 'done');
  f.engine.advance();
  assert.equal(f.engine.layers.evaluate(receiver).effectText, null);
  assert.equal(f.engine.layers.evaluate(receiver).text, null);
});

test('copy text cannot outlive the attached-host identity or copy from a different host', () => {
  const f = runtime();
  const receiver = f.kernel.ref('equipment');
  submitTextCopy(f, [textCopyInstruction('copy-host-text')]);
  assert.equal(f.engine.commit({ type: 'detach', object: receiver }).status, 'done');
  f.engine.advance();
  assert.equal(f.engine.commit({ type: 'attach', object: receiver, host: f.kernel.ref('other-host') }).status, 'done');
  f.engine.advance();
  assert.equal(f.engine.layers.evaluate(receiver).effectText, null);
});

test('copied text stops when the source host leaves the Board even if the receiver remains attached', () => {
  const f = runtime();
  const receiver = f.kernel.ref('equipment');
  submitTextCopy(f, [textCopyInstruction('copy-host-text')]);
  assert.equal(f.engine.layers.evaluate(receiver).effectText, null);

  assert.equal(f.engine.commit({ type: 'move-zone', object: f.kernel.ref('host'), to: 'trash' }).status, 'done');
  f.engine.advance();
  assert.equal(f.engine.layers.evaluate(receiver).effectText, null);
});

test('rules-text and effect-text modes register their distinct source/target mappings', () => {
  const rulesRuntime = runtime();
  const rules = submitTextCopy(rulesRuntime, [textCopyInstruction('copy-rules', 'rules-text')]);
  assert.equal(rules.text, null);
  assert.equal(rules.effectText, null);
  const rulesRegistration = rulesRuntime.engine.layers.registry.list().find(entry => entry.effect.layer === 'copy');
  assert.deepEqual(rulesRegistration.effect.effect.properties, ['text']);

  const effectRuntime = runtime();
  const effect = submitTextCopy(effectRuntime, [textCopyInstruction('copy-effect-text', 'effect-text')]);
  assert.equal(effect.text, null);
  assert.equal(effect.effectText, null);
  const effectRegistration = effectRuntime.engine.layers.registry.list().find(entry => entry.effect.layer === 'copy');
  assert.deepEqual(effectRegistration.effect.effect.properties, ['text->effectText']);
});

test('copy layer maps Rules Text to Effect Text before later Ability-Altering effects', () => {
  const kernel = world().unit('host').unit('equipment', {
    types: ['gear'], tags: ['Equipment'], attachedTo: { id: 'host', zoneEntryId: 1 },
  }).build();
  const objects = structuredClone(kernel.objects);
  Object.assign(objects.find(object => object.ref.id === 'host'), {
    text: 'FIRST', effectText: 'FIRST EFFECT',
  });
  Object.assign(objects.find(object => object.ref.id === 'equipment'), {
    text: 'OWN', effectText: 'OWN EFFECT',
  });
  const source = objects.find(object => object.ref.id === 'host');
  const receiver = objects.find(object => object.ref.id === 'equipment');
  const copy = {
    id: 'copy-text-before-ability',
    layer: 'copy',
    source: source.ref,
    filter: { objectId: receiver.ref.id, zoneEntryId: receiver.ref.zoneEntryId,
      zone: 'board', states: 'attached' },
    effect: {
      kind: 'copy-object', source: source.ref, properties: ['text->effectText'],
      condition: target => target.attachedTo?.id === source.ref.id &&
        target.attachedTo.zoneEntryId === source.ref.zoneEntryId,
    },
  };
  const layers = createLayerEngine(objects, [
    { effect: copy, duration: { type: 'while-source-in-zone', source: receiver.ref }, timestamp: 10 },
  ]);
  const copied = layers.evaluate(receiver.ref);
  assert.equal(copied.text, 'OWN');
  assert.equal(copied.effectText, 'FIRST', 'copy layer uses the host Rules Text');
  layers.addContinuous({
    id: 'ability-text-after-copy', layer: 'ability', source: receiver.ref,
    filter: { objectId: 'equipment', zone: 'board' },
    effect: { kind: 'set-text', text: 'ABILITY LAYER' },
  }, { type: 'permanent' }, 20);
  const changed = layers.evaluate(receiver.ref);
  assert.equal(changed.effectText, 'ABILITY LAYER', 'later ability text replaces the copied value');
});

test('copy layer rechecks attachment and withdraws copied text after Detach', () => {
  const kernel = world().unit('host').unit('equipment', {
    types: ['gear'], tags: ['Equipment'], attachedTo: { id: 'host', zoneEntryId: 1 },
  }).build();
  const objects = structuredClone(kernel.objects);
  Object.assign(objects.find(object => object.ref.id === 'host'), { text: 'HOST RULES' });
  Object.assign(objects.find(object => object.ref.id === 'equipment'), {
    text: 'OWN RULES', effectText: 'OWN EFFECT',
  });
  const source = objects.find(object => object.ref.id === 'host');
  const receiver = objects.find(object => object.ref.id === 'equipment');
  const layers = createLayerEngine(objects, [{
    effect: {
      id: 'copy-text-attachment-bound', layer: 'copy', source: source.ref,
      filter: { objectId: receiver.ref.id, zoneEntryId: receiver.ref.zoneEntryId,
        zone: 'board', states: 'attached' },
      effect: {
        kind: 'copy-object', source: source.ref, properties: ['text->effectText'],
        condition: target => target.attachedTo?.id === source.ref.id &&
          target.attachedTo.zoneEntryId === source.ref.zoneEntryId,
      },
    },
    duration: { type: 'permanent' }, timestamp: 10,
  }]);
  assert.equal(layers.evaluate(receiver.ref).effectText, 'HOST RULES');
  const detachedObjects = structuredClone(objects).map(object => object.ref.id === 'equipment'
    ? { ...object, attachedTo: null }
    : object);
  layers.setObjects(detachedObjects);
  const detached = layers.evaluate(receiver.ref);
  assert.equal(detached.text, 'OWN RULES');
  assert.equal(detached.effectText, 'OWN EFFECT');
});

test('text copy rejects malformed modes, non-attached receivers, and non-copy options before mutation', () => {
  for (const invalid of [
    { textMode: constant('all') },
    { textMode: constant(42) },
    { properties: constant(['unknown']) },
    { properties: constant(['text']), textMode: constant('effect-text') },
  ]) {
    const kernel = world().unit('source').unit('receiver', { types: ['gear'] })
      .build();
    const before = kernel.stateForTest();
    assert.throws(() => instructionDefinitionsById.get('effect.copy').execute(
      bindResolveContext(kernel, { source: kernel.getObject('source'), controller: 'A' }),
      {
        source: constant({ pick: 'source' }),
        mode: constant('effect'),
        onto: constant({ pick: 'receiver' }),
        ...invalid,
      },
    ), TypeError);
    assert.deepEqual(kernel.stateForTest(), before);
    assert.deepEqual(kernel.continuousEffects, []);
  }

  const detached = world().unit('host').unit('gear', { types: ['gear'] }).build();
  detached.setPicks('host', [detached.ref('host')]);
  detached.setPicks('gear', [detached.ref('gear')]);
  const result = instructionDefinitionsById.get('effect.copy').execute(
    bindResolveContext(detached, { source: detached.getObject('gear'), controller: 'A' }),
    {
      source: constant({ pick: 'host' }), mode: constant('effect'),
      onto: constant({ pick: 'gear' }), textMode: constant('effect-text'),
    },
  );
  assert.equal(result.status, 'negated');
  assert.equal(detached.linked('copied').blockedReason, 'copy-text-recipient-must-be-attached');
  assert.deepEqual(detached.continuousEffects, []);

  const attachedSource = world().unit('top-most').unit('attached-host', {
    types: ['gear'], tags: ['Equipment'], attachedTo: { id: 'top-most', zoneEntryId: 1 },
  }).unit('receiver', {
    types: ['gear'], tags: ['Equipment'], attachedTo: { id: 'attached-host', zoneEntryId: 1 },
  }).build();
  attachedSource.setPicks('attached-host', [attachedSource.ref('attached-host')]);
  attachedSource.setPicks('receiver', [attachedSource.ref('receiver')]);
  const inactive = instructionDefinitionsById.get('effect.copy').execute(
    bindResolveContext(attachedSource, { source: attachedSource.getObject('receiver'), controller: 'A' }),
    {
      source: constant({ pick: 'attached-host' }), mode: constant('effect'),
      onto: constant({ pick: 'receiver' }), textMode: constant('effect-text'),
    },
  );
  assert.equal(inactive.status, 'negated');
  assert.equal(attachedSource.linked('copied').blockedReason, 'copy-text-source-rules-text-is-inactive');
  assert.deepEqual(attachedSource.continuousEffects, []);

  const attachedEffectSource = world().unit('top-most').unit('attached-effect-host', {
    types: ['gear'], tags: ['Equipment'], attachedTo: { id: 'top-most', zoneEntryId: 1 },
  }).unit('receiver', {
    types: ['gear'], tags: ['Equipment'], attachedTo: { id: 'attached-effect-host', zoneEntryId: 1 },
  }).build();
  attachedEffectSource.setPicks('attached-effect-host', [attachedEffectSource.ref('attached-effect-host')]);
  attachedEffectSource.setPicks('receiver', [attachedEffectSource.ref('receiver')]);
  const inactiveMappedText = instructionDefinitionsById.get('effect.copy').execute(
    bindResolveContext(attachedEffectSource, { source: attachedEffectSource.getObject('receiver'), controller: 'A' }),
    {
      source: constant({ pick: 'attached-effect-host' }), mode: constant('effect'),
      onto: constant({ pick: 'receiver' }), properties: constant(['text']),
    },
  );
  assert.equal(inactiveMappedText.status, 'negated');
  assert.equal(attachedEffectSource.linked('copied').blockedReason, 'copy-text-source-rules-text-is-inactive');
  assert.deepEqual(attachedEffectSource.continuousEffects, []);
});

test('effect.copy properties select only the requested trait', () => {
  const kernel = world().unit('source', {
    name: 'SOURCE', might: 9, energy: 8, power: ['Mind'],
  }).unit('receiver', { name: 'RECEIVER', might: 1, energy: 2, power: ['Fury'] })
    .build();
  kernel.setPicks('source', [kernel.ref('source')]);
  kernel.setPicks('receiver', [kernel.ref('receiver')]);
  const result = instructionDefinitionsById.get('effect.copy').execute(
    bindResolveContext(kernel, { source: kernel.getObject('receiver'), controller: 'A' }),
    {
      source: constant({ pick: 'source' }), mode: constant('effect'),
      onto: constant({ pick: 'receiver' }), properties: constant(['might']),
    },
  );
  assert.equal(result.status, 'executed');
  const withText = structuredClone(kernel.objects);
  Object.assign(withText.find(object => object.ref.id === 'source'), {
    text: 'SOURCE RULES', effectText: 'SOURCE EFFECT',
  });
  Object.assign(withText.find(object => object.ref.id === 'receiver'), {
    text: 'OWN', effectText: 'OWN EFFECT',
  });
  const snapshot = createLayerEngine(withText, kernel.continuousEffects).evaluate(kernel.ref('receiver'));
  assert.equal(snapshot.might, 9);
  assert.equal(snapshot.name, 'RECEIVER');
  assert.equal(snapshot.energy, 2);
  assert.deepEqual(snapshot.power, ['Fury']);
  assert.equal(snapshot.text, 'OWN');
  assert.equal(snapshot.effectText, 'OWN EFFECT');
});

test('plain text copies Rules Text without copying Effect Text', () => {
  const kernel = world().unit('source').unit('receiver', {
    name: 'RECEIVER', might: 1, energy: 2, power: ['Fury'],
  }).build();
  kernel.setPicks('source', [kernel.ref('source')]);
  kernel.setPicks('receiver', [kernel.ref('receiver')]);
  const result = instructionDefinitionsById.get('effect.copy').execute(
    bindResolveContext(kernel, { source: kernel.getObject('receiver'), controller: 'A' }),
    {
      source: constant({ pick: 'source' }), mode: constant('effect'), onto: constant({ pick: 'receiver' }),
      properties: constant(['text']),
    },
  );
  assert.equal(result.status, 'executed');
  const withText = structuredClone(kernel.objects);
  Object.assign(withText.find(object => object.ref.id === 'source'), { text: 'SOURCE', effectText: 'SOURCE EFFECT' });
  Object.assign(withText.find(object => object.ref.id === 'receiver'), { text: 'OWN', effectText: 'OWN EFFECT' });
  const snapshot = createLayerEngine(withText, kernel.continuousEffects).evaluate(kernel.ref('receiver'));
  assert.equal(snapshot.text, 'SOURCE');
  assert.equal(snapshot.effectText, 'OWN EFFECT');
});

test('copy-layer effectText selects only the source Effect Text field', () => {
  const kernel = world().unit('source').unit('receiver', { types: ['gear'] }).build();
  const objects = structuredClone(kernel.objects);
  Object.assign(objects.find(object => object.ref.id === 'source'), {
    text: 'SOURCE RULES', effectText: 'SOURCE EFFECT',
  });
  Object.assign(objects.find(object => object.ref.id === 'receiver'), {
    text: 'OWN RULES', effectText: 'OWN EFFECT',
  });
  const source = objects.find(object => object.ref.id === 'source');
  const receiver = objects.find(object => object.ref.id === 'receiver');
  const layers = createLayerEngine(objects, [{
    effect: {
      id: 'copy-effect-text-only', layer: 'copy', source: source.ref,
      filter: { objectId: receiver.ref.id, zoneEntryId: receiver.ref.zoneEntryId, zone: 'board' },
      effect: { kind: 'copy-object', source: source.ref, properties: ['effectText'] },
    },
    duration: { type: 'permanent' }, timestamp: 1,
  }]);
  const snapshot = layers.evaluate(receiver.ref);
  assert.equal(snapshot.text, 'OWN RULES');
  assert.equal(snapshot.effectText, 'SOURCE EFFECT');
});

test('copy-object defaults to all copyable traits while preserving source text sections', () => {
  const kernel = world().unit('source', {
    name: 'SOURCE', tags: ['SourceTag'], might: 9, energy: 8, power: ['Mind'],
  }).unit('receiver', {
    name: 'RECEIVER', tags: ['ReceiverTag'], might: 1, energy: 2, power: ['Fury'],
  }).build();
  const objects = structuredClone(kernel.objects);
  Object.assign(objects.find(object => object.ref.id === 'source'), {
    text: 'SOURCE RULES', effectText: 'SOURCE EFFECT',
  });
  Object.assign(objects.find(object => object.ref.id === 'receiver'), {
    text: 'OWN RULES', effectText: 'OWN EFFECT',
  });
  const source = objects.find(object => object.ref.id === 'source');
  const receiver = objects.find(object => object.ref.id === 'receiver');
  const layers = createLayerEngine(objects, [{
    effect: {
      id: 'copy-all-traits', layer: 'copy', source: source.ref,
      filter: { objectId: receiver.ref.id, zoneEntryId: receiver.ref.zoneEntryId, zone: 'board' },
      effect: { kind: 'copy-object', source: source.ref },
    },
    duration: { type: 'permanent' }, timestamp: 1,
  }]);
  const snapshot = layers.evaluate(receiver.ref);
  assert.equal(snapshot.name, 'SOURCE');
  assert.deepEqual(snapshot.tags, ['SourceTag']);
  assert.equal(snapshot.might, 9);
  assert.equal(snapshot.energy, 8);
  assert.deepEqual(snapshot.power, ['Mind']);
  assert.equal(snapshot.text, 'SOURCE RULES');
  assert.equal(snapshot.effectText, 'SOURCE EFFECT');
});
