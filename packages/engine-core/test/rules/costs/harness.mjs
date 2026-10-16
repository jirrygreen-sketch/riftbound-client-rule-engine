// Shared rules-golden harness for docs/rules/scenarios/costs.yaml.
//
// The tests in this directory execute the merged, non-duel kernel layers:
// the reference test kernel (src/effects/testing), the ChainEngine
// (src/chain), the cost plan/payment layer (src/cost) and the migrated
// resource kernel (src/cost/resources). Nothing here mutates state by hand;
// scenarios are built through public layer APIs and every assertion reads the
// resulting state or the immutable payment receipt.
import { world, AwaitChoice } from '../../../dist/effects/testing/index.js';
import { runInstruction } from '../../../dist/effects/testing/index.js';
import { createActionPipelineHost, bindResolveContext } from '../../../dist/events/action-adapter.js';
import { ChainEngine } from '../../../dist/chain/engine.js';
import { buildCostPlan } from '../../../dist/cost/cost-plan.js';
import { payCostPlan, prepareCostPayment } from '../../../dist/cost/payment.js';
import { CostPlanError } from '../../../dist/cost/plan-types.js';
import { finalizeTargetPlan, resolveTargetPlan } from '../../../dist/target/target-plan.js';
import {
  DUEL_DOMAINS,
  activateBasicRuneEnergy,
  activateBasicRunePower,
  activateDuelGoldPower,
  channelDuelRunes,
  clearAllDuelRunePools,
  createDuelResources,
  createDuelGoldToken,
  payDuelRuneCost,
  planDuelRunePayment
} from '../../../dist/cost/resources.js';

export { world, AwaitChoice, runInstruction, ChainEngine, buildCostPlan, payCostPlan, prepareCostPayment, CostPlanError };
export { finalizeTargetPlan, resolveTargetPlan };
export {
  DUEL_DOMAINS,
  activateBasicRuneEnergy,
  activateBasicRunePower,
  activateDuelGoldPower,
  channelDuelRunes,
  clearAllDuelRunePools,
  createDuelResources,
  createDuelGoldToken,
  payDuelRuneCost,
  planDuelRunePayment
};

/** card-dsl constant expression */
export const constant = value => ({ kind: 'constant', value });

/** A printed-cost plan input for the given source snapshot. */
export const printedCost = (id = 'cost', extra = {}) => ({ id, cost: { kind: 'printed' }, ...extra });

/**
 * A ResolveContext bound to one already-existing object as its ability source.
 * Used by cost-layer tests that only need ctx reads/perform, not a chain.
 */
export function withSource(kernel, id, controller = 'A') {
  return kernel.clone({ sourceSnapshot: kernel.getObject(id), controller });
}

/** build + pay one cost plan through the public cost-layer API. */
export function payPlan(ctx, input, options) {
  const plan = buildCostPlan(ctx, input);
  const receipt = payCostPlan(ctx, plan, options);
  return { plan, receipt };
}

/** A six-domain Power requirement, i.e. [A] / a domainless [C] (135.2.e.5.a, 163.2.b). */
export const anyDomainPower = (amount = 1) => ({
  payments: [{ kind: 'power', amount: constant(amount), allowedDomains: [...DUEL_DOMAINS] }]
});

/** A normal-speed spell draft for a card currently in the given zone. */
export function spellDraft(kernel, id, overrides = {}) {
  return {
    id,
    controller: 'A',
    kind: 'spell',
    speed: 'normal',
    source: kernel.getObject(id),
    body: [],
    ...overrides
  };
}

/** A normal-speed unit draft for a card currently in Hand. */
export function unitDraft(kernel, id, overrides = {}) {
  return {
    id,
    controller: 'A',
    kind: 'unit',
    speed: 'normal',
    source: kernel.getObject(id),
    body: [],
    location: { type: 'base', player: 'A' },
    ...overrides
  };
}

/** An activated-ability draft for a permanent already on the Board. */
export function activatedDraft(kernel, id, overrides = {}) {
  return {
    id,
    controller: 'A',
    kind: 'activated',
    speed: 'reaction',
    source: kernel.getObject(id),
    body: [],
    ...overrides
  };
}

/**
 * Build a ChainEngine over a reference-kernel world. `choose` may supply
 * answers; when it returns undefined and exactly one selection is legal,
 * the harness answers automatically (same convenience as test/chain).
 */
export function makeEngine(kernel, options = {}) {
  const answers = new Map(Object.entries(options.answers ?? {}));
  const decide = request => {
    if (answers.has(request.id)) return answers.get(request.id);
    if (options.choose) {
      const answer = options.choose(request, kernel);
      if (answer !== undefined) return answer;
    }
    if (request.type === 'select-objects' && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: decide }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const lethalCleanup = engine => {
    let changed = false;
    engine.layers.setObjects(kernel.objects);
    for (const object of engine.layers.evaluateAll()) {
      if (object.zone === 'board' && object.types.includes('unit') && object.might !== null && (object.might <= 0 || object.damage >= object.might)) {
        const before = kernel.ref(object.ref.id);
        engine.commit({ type: 'kill', object: object.ref });
        const after = kernel.ref(object.ref.id);
        changed ||= before.zoneEntryId !== after.zoneEntryId;
      }
    }
    return changed;
  };
  const engine = new ChainEngine({
    turnOrder: options.turnOrder ?? ['A', 'B'],
    turnPlayer: options.turnPlayer ?? 'A',
    phase: options.phase ?? 'main',
    host,
    cleanup: options.cleanup ?? lethalCleanup
  });
  return { engine, kernel, host, answers };
}

/** Resolve every chain item by passing priority until the chain is empty. */
export function resolveAll(engine) {
  let guard = 0;
  while (engine.items.length) {
    if (++guard > 50) throw new Error('Nonterminating test chain');
    engine.pass(engine.priority);
  }
}

/** Chain lifecycle trace reduced to `step:item` pairs. */
export function stages(engine) {
  return engine.trace
    .filter(event => ['pending', 'finalized', 'resolved', 'removed'].includes(event.step))
    .map(event => `${event.step}:${event.item}`);
}

/** Event timings recorded by the unified pipeline. */
export function timings(engine) {
  return engine.trace.filter(event => event.step === 'event').map(event => event.timingPoint);
}

/** Actions of a payment receipt, in payment order. */
export function receiptActions(receipt) {
  return receipt.actions.map(entry => entry.action);
}

/** Assert a CostPlanError with the exact reason. */
export function costFailure(reason) {
  return error => error instanceof CostPlanError && error.reason === reason;
}

/** Two-player Base locations for the migrated resource kernel. */
export const BASE_LOCATIONS = Object.freeze([
  { playerId: 'A', locationId: 'base:A' },
  { playerId: 'B', locationId: 'base:B' }
]);

/** A Rune Deck entry for one basic Rune of the given domain. */
export const basicRune = (uid, domain) => ({ uid, cardId: `rune:${domain}`, domain });

/** Trusted resource state with the given ordered Rune Decks. */
export function resources(runeDecks) {
  return createDuelResources({ playerIds: ['A', 'B'], baseLocations: BASE_LOCATIONS, runeDecks });
}

/** A payment window held by A, as produced by the enclosing Finalize step. */
export function paymentWindow(playerId = 'A', overrides = {}) {
  return { stateOpen: false, priorityPlayerId: null, resourcePaymentPlayerId: playerId, ...overrides };
}
