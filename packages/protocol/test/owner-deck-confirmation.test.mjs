import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isClientMessage, isOwnerDeckConfirmationMessage, isServerMessage,
  OWNER_DECK_CONFIRMATION_SCHEMA, FOUNDATION_RULESET_ID, DUEL_RULESET_ID
} from '../dist/index.js';

const message = {
  type: 'owner-deck-confirmation', schema: OWNER_DECK_CONFIRMATION_SCHEMA,
  roomId: 'room-1', playerId: 'player-1', rulesetId: FOUNDATION_RULESET_ID,
  roomVersion: 4, roomEventSeq: 3,
  catalog: { dataVersion: 'data-v1', digest: 'sha256:trusted-catalog' },
  deck: { mainDeck: [{ cardId: 'print-1', quantity: 2 }],
    runes: [{ cardId: 'rune-1', quantity: 12 }] }
};

test('exact owner-only server envelope, nullable deck and six-zone inventory', () => {
  for (const rulesetId of [FOUNDATION_RULESET_ID, DUEL_RULESET_ID]) {
    assert.equal(isOwnerDeckConfirmationMessage({ ...message, rulesetId }), true);
    assert.equal(isServerMessage({ ...message, rulesetId, deck: null }), true);
  }
  assert.equal(isClientMessage(message), false);
  assert.equal(isServerMessage({ ...message, deck: { ...message.deck, sideboard: [] } }), true);
  assert.equal(isServerMessage({ ...message, deck: {} }), false);
  assert.equal(isServerMessage({ ...message, rulesetId: 'synthetic-demo' }), false);
});

test('rejects extras, missing fields and malformed catalog/context', () => {
  for (const invalid of [
    { ...message, requestId: 'fake-ack' }, { ...message, schema: 'owner-deck-confirmation-v2' },
    { ...message, roomVersion: 4.5 }, { ...message, roomVersion: -1 },
    { ...message, roomEventSeq: -1 }, { ...message, playerId: '' },
    { ...message, catalog: { ...message.catalog, password: 'secret' } },
    { ...message, catalog: { dataVersion: '', digest: 'x' } },
    { ...message, catalog: { dataVersion: 'x' } }
  ]) assert.equal(isServerMessage(invalid), false, JSON.stringify(invalid));
});

test('rejects duplicate zone printing, malformed quantity, overflow and surplus descriptor', () => {
  const invalidDecks = [
    { mainDeck: [message.deck.mainDeck[0], message.deck.mainDeck[0]] },
    { mainDeck: [{ cardId: 'x', quantity: 1, canonicalCardId: 'x' }] },
    { mainDeck: [{ cardId: 'x', quantity: 0 }] },
    { mainDeck: [{ cardId: 'x', quantity: 0.5 }] },
    { mainDeck: [{ cardId: 'x', quantity: Number.MAX_SAFE_INTEGER }, { cardId: 'y', quantity: 1 }] },
    { other: [{ cardId: 'x', quantity: 1 }] },
    { runes: { cardId: 'x', quantity: 1 } },
    { runes: [{ cardId: '', quantity: 1 }] }
  ];
  for (const deck of invalidDecks) {
    assert.equal(isServerMessage({ ...message, deck }), false, JSON.stringify(deck));
  }
});

test('private echo never widens public room or input deck schema', () => {
  const room = { roomId: 'room-1', status: 'waiting', rulesetId: FOUNDATION_RULESET_ID,
    version: 0, roomVersion: 4, roomEventSeq: 3, players: [{ id: 'player-1', name: 'Alice',
      ready: false, connected: true, deckSubmitted: true }] };
  assert.equal(isServerMessage({ type: 'room', room }), true);
  assert.equal(isServerMessage({ type: 'room', room: { ...room, deck: message.deck } }), false);
  assert.equal(isServerMessage({ type: 'room', room: { ...room, players: [
    { ...room.players[0], deck: message.deck } ] } }), false);
  assert.equal(isClientMessage({ type: 'submit-deck', requestId: 'r1', expectedRoomVersion: 4,
    deck: message.deck, catalog: message.catalog }), false);
});

// ---- wave125: canonical plain/dense contract on the public parser ----

function nullProtoRecord(source) {
  const target = Object.create(null);
  for (const key of Object.keys(source)) target[key] = source[key];
  return target;
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

test('rejects custom-prototype, non-enumerable, symbol and hidden own extras', () => {
  const inherited = Object.assign(Object.create({ inheritedExtra: 'not JSON wire data' }), message);
  assert.equal(isOwnerDeckConfirmationMessage(inherited), false);

  const hidden = { ...message };
  Object.defineProperty(hidden, 'hiddenExtra', { value: 1, enumerable: false });
  assert.equal(isOwnerDeckConfirmationMessage(hidden), false);

  const symbolised = { ...message };
  symbolised[Symbol('hiddenExtra')] = 1;
  assert.equal(isOwnerDeckConfirmationMessage(symbolised), false);

  const hiddenCatalog = { ...message, catalog: { ...message.catalog } };
  Object.defineProperty(hiddenCatalog.catalog, 'hiddenExtra', { value: 1, enumerable: false });
  assert.equal(isOwnerDeckConfirmationMessage(hiddenCatalog), false);

  const symbolCatalog = { ...message, catalog: { ...message.catalog } };
  symbolCatalog.catalog[Symbol('hiddenExtra')] = 1;
  assert.equal(isOwnerDeckConfirmationMessage(symbolCatalog), false);

  const hiddenDeck = { ...message, deck: { ...message.deck } };
  Object.defineProperty(hiddenDeck.deck, 'hiddenExtra', { value: 1, enumerable: false });
  assert.equal(isOwnerDeckConfirmationMessage(hiddenDeck), false);
});

test('rejects own accessors without ever invoking them', () => {
  let topCalls = 0;
  const topAccessor = { ...message };
  Object.defineProperty(topAccessor, 'schema', {
    get() { topCalls += 1; return OWNER_DECK_CONFIRMATION_SCHEMA; }, enumerable: true, configurable: true
  });
  assert.equal(isOwnerDeckConfirmationMessage(topAccessor), false);
  assert.equal(topCalls, 0);

  let entryCalls = 0;
  const entry = { cardId: 'print-1', quantity: 2 };
  Object.defineProperty(entry, 'quantity', {
    get() { entryCalls += 1; return 2; }, enumerable: true, configurable: true
  });
  assert.equal(isOwnerDeckConfirmationMessage({ ...message, deck: { mainDeck: [entry] } }), false);
  assert.equal(entryCalls, 0);

  let indexCalls = 0;
  const list = [{ cardId: 'print-1', quantity: 2 }];
  Object.defineProperty(list, '0', {
    get() { indexCalls += 1; return { cardId: 'print-1', quantity: 2 }; }, enumerable: true, configurable: true
  });
  assert.equal(isOwnerDeckConfirmationMessage({ ...message, deck: { mainDeck: list } }), false);
  assert.equal(indexCalls, 0);
});

test('rejects non-canonical arrays: holes, extras, symbols, exotic prototypes and hidden indexes', () => {
  const hole = [];
  hole[1] = { cardId: 'print-1', quantity: 2 };
  assert.equal(isOwnerDeckConfirmationMessage({ ...message, deck: { mainDeck: hole } }), false);

  const extra = [{ cardId: 'print-1', quantity: 2 }];
  extra.arrayExtra = 'not an element';
  assert.equal(isOwnerDeckConfirmationMessage({ ...message, deck: { mainDeck: extra } }), false);

  const symbolArray = [{ cardId: 'print-1', quantity: 2 }];
  symbolArray[Symbol('extra')] = 1;
  assert.equal(isOwnerDeckConfirmationMessage({ ...message, deck: { mainDeck: symbolArray } }), false);

  const exotic = [{ cardId: 'print-1', quantity: 2 }];
  Object.setPrototypeOf(exotic, null);
  assert.equal(isOwnerDeckConfirmationMessage({ ...message, deck: { mainDeck: exotic } }), false);

  class DeckArray extends Array {}
  const subclass = DeckArray.from([{ cardId: 'print-1', quantity: 2 }]);
  assert.equal(isOwnerDeckConfirmationMessage({ ...message, deck: { mainDeck: subclass } }), false);

  const hiddenIndex = [{ cardId: 'print-1', quantity: 2 }];
  Object.defineProperty(hiddenIndex, '0', {
    value: { cardId: 'print-1', quantity: 2 }, enumerable: false, configurable: true
  });
  assert.equal(isOwnerDeckConfirmationMessage({ ...message, deck: { mainDeck: hiddenIndex } }), false);
});

test('accepts null-prototype and deeply frozen canonical records', () => {
  const base = JSON.parse(JSON.stringify(message));
  const nullProto = nullProtoRecord(base);
  nullProto.catalog = nullProtoRecord(base.catalog);
  nullProto.deck = nullProtoRecord(base.deck);
  assert.equal(isOwnerDeckConfirmationMessage(nullProto), true);

  assert.equal(isOwnerDeckConfirmationMessage(deepFreeze(JSON.parse(JSON.stringify(message)))), true);
  assert.equal(isServerMessage(deepFreeze(JSON.parse(JSON.stringify({ ...message, deck: null })))), true);
});

test('JSON round-trip preserves every original legal shape: six zones, null clear, unique counts', () => {
  const roundTrip = value => JSON.parse(JSON.stringify(value));
  const legal = [
    message,
    { ...message, rulesetId: DUEL_RULESET_ID },
    { ...message, deck: null },
    { ...message, deck: { ...message.deck, sideboard: [] } },
    { ...message, deck: { mainDeck: [{ cardId: 'a', quantity: 3 }, { cardId: 'b', quantity: 1 }] } }
  ];
  for (const value of legal) {
    assert.equal(isOwnerDeckConfirmationMessage(roundTrip(value)), true, JSON.stringify(value));
    assert.equal(isServerMessage(roundTrip(value)), true, JSON.stringify(value));
  }
  assert.equal(isOwnerDeckConfirmationMessage(roundTrip({ ...message, extra: 1 })), false);
  assert.equal(isOwnerDeckConfirmationMessage(roundTrip({
    ...message, deck: { other: [{ cardId: 'a', quantity: 1 }] } })), false);
  assert.equal(isOwnerDeckConfirmationMessage(roundTrip({
    ...message, deck: { mainDeck: [{ cardId: 'a', quantity: 1 }, { cardId: 'a', quantity: 1 }] } })), false);
});

test('fails closed (false) when a raw Proxy trap throws', () => {
  const throwingKeys = new Proxy({ ...message }, {
    ownKeys() { throw new Error('hostile ownKeys trap'); }
  });
  assert.equal(isOwnerDeckConfirmationMessage(throwingKeys), false);

  const throwingProto = new Proxy({ ...message }, {
    getPrototypeOf() { throw new Error('hostile getPrototypeOf trap'); }
  });
  assert.equal(isOwnerDeckConfirmationMessage(throwingProto), false);
});
