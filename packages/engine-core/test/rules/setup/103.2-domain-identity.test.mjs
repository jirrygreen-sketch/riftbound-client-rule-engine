// Golden test placeholders for the setup chapter Domain Identity scenarios
//   setup-domain-identity-single-domain-ok
//   setup-domain-identity-off-domain-card
//   setup-domain-identity-multidomain-card
// (docs/rules/scenarios/setup.yaml).
//
// CR v1.5 103.2.b: the Champion Legend dictates the deck's Domain Identity.
// 103.2.b.1: cards included in the deck must abide by it; 103.2.b.3: a card with
// a single Domain is permitted in the Domain Identity that contains that Domain;
// 103.2.b.4: a multi-Domain card is permitted only when the identity contains all
// of its Domains; 103.2.b.5: a card with no Domain is permitted in any Domain
// Identity.
//
// These are deck building checks, and in this repo their only implementation is a
// consumer outside the rules engine: apps/game-server/src/constructed-policy.ts
// ships the `domain-identity` check over the catalog. packages/card-data/src/
// index.ts exports a generic `validateDeck` (collection/data version, copy limits,
// required tags, allowed types) with no Domain Identity stage, and engine-core
// owns no deck legality module at all (src/deck/index.ts is `export {}`). The
// engine-core setup chapter therefore has no validator to drive these scenarios.
import test from 'node:test';

test.todo('setup-domain-identity-single-domain-ok (103.2.b.1 / 103.2.b.3): a single-Domain card matching the Champion Legend\'s Domain identity validates — blocked: engine-core has no deck legality module (src/deck/index.ts is `export {}`); Domain Identity lives in apps/game-server/src/constructed-policy.ts, outside this task\'s write scope');

test.todo('setup-domain-identity-off-domain-card (103.2.b.1 / 103.2.b.3): a card outside the Champion Legend\'s Domain identity makes the deck invalid — blocked: same owner split; card-data validateDeck has no Domain Identity stage and engine-core has no validator to drive');

test.todo('setup-domain-identity-multidomain-card (103.2.b.4 / 103.2.b.5): a multi-Domain card needs every Domain in the identity while a Domain-less card is always allowed — blocked: same owner split; the multi-Domain subset check exists only in the game-server constructed policy');
