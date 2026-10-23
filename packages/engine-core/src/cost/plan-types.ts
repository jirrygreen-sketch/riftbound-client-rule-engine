import type { CostSpec, Expr } from '@riftbound/card-dsl';
import type {
  ActionOutcome, Domain, GameAction, GameEvent, ObjectRef, PlayerId
} from '../effects/contract.js';
import type { DuelPrintedCostCatalogCard } from './printed-costs.js';
import type { DuelPaymentPlan, DuelPowerRequirement } from './resources.js';

export type CostStage = 'base' | 'alternate' | 'optional-additional' | 'mandatory-additional' | 'increase' | 'discount' | 'total';

export interface CostComponentInput {
  readonly id: string;
  readonly cost: CostSpec;
}

export interface OptionalCostInput {
  readonly id: string;
  readonly kind: 'additional' | 'repeat' | 'accelerate';
  readonly cost?: CostSpec;
  readonly selected?: boolean;
}

export type BaseCostModification =
  | { readonly kind: 'alternate' | 'flow'; readonly id: string; readonly cost: CostSpec }
  | { readonly kind: 'ignore-base'; readonly ignore: 'energy' | 'power' | 'resources' };

export interface CostDiscount {
  readonly id: string;
  readonly component?: string;
  readonly resource: 'energy' | 'power';
  readonly amount: Expr;
  readonly minimum?: Expr;
  readonly domains?: readonly Domain[];
  readonly powerOrder?: readonly number[];
}

export interface CostPlanInput {
  readonly id: string;
  readonly cost: CostSpec;
  readonly printed?: DuelPrintedCostCatalogCard;
  readonly domains?: readonly Domain[];
  readonly baseChoices?: readonly CostComponentInput[];
  readonly baseChoice?: string;
  readonly baseModifications?: readonly BaseCostModification[];
  readonly optionalAdditional?: readonly OptionalCostInput[];
  readonly mandatoryAdditional?: readonly CostComponentInput[];
  readonly increases?: readonly CostComponentInput[];
  readonly discounts?: readonly CostDiscount[];
  readonly discountOrder?: readonly string[];
  readonly ignoreAllCosts?: boolean;
  /** Finalize-locked non-target cost choices; retries must reuse these receipts. */
  readonly costChoices?: CostChoiceLocks;
}

/** Stable Resolve binding for the cost paid by a removed leading cost.pay. */
export interface LeadingCostReceiptBinding {
  readonly instructionId: string;
  readonly link: string;
  readonly choiceIds: readonly string[];
}

export type NonstandardCostAction = Extract<GameAction, {
  type: 'exhaust' | 'discard' | 'recycle' | 'kill' | 'banish' | 'disempower' | 'reveal' | 'spend-buff'
}>;

/** A non-target object selection locked by Finalize for a cost component. */
export interface CostChoiceReceipt {
  readonly id: string;
  readonly kind: string;
  readonly min: number;
  readonly max: number;
  readonly count: number;
  readonly objects: readonly ObjectRef[];
}

/**
 * Serialized Finalize decision for one non-target cost PickSpec. The Chain
 * owner must persist this before building the plan and pass the same receipt
 * back on every retry; ids and object incarnations are not recomputed.
 */
export interface CostChoiceLock {
  readonly planId: string;
  readonly choiceId: string;
  readonly kind: string;
  readonly receipt: CostChoiceReceipt;
}

export interface CostChoiceLocks {
  readonly locks: readonly CostChoiceLock[];
}

/** Additive Finalize input: one lock per encountered cost object choice. */
export interface CostChoicePlanInput {
  readonly costChoices?: CostChoiceLocks;
}

export interface CostAction {
  readonly id: string;
  readonly componentId: string;
  readonly action: NonstandardCostAction;
  readonly choiceId?: string;
}

export interface CostAmount {
  readonly energy: number;
  readonly power: readonly DuelPowerRequirement[];
  readonly xp: number;
  readonly actions: readonly CostAction[];
  readonly choices?: readonly CostChoiceReceipt[];
}

export interface CostComponent {
  readonly id: string;
  readonly stage: 'base' | 'optional-additional' | 'mandatory-additional' | 'increase';
  readonly kind: string;
  readonly original: CostAmount;
  readonly cost: CostAmount;
}

export interface AppliedCostDiscount {
  readonly id: string;
  readonly component: string | null;
  readonly resource: 'energy' | 'power';
  readonly amount: number;
  readonly minimum: number;
  readonly before: number;
  readonly after: number;
}

export interface CostPlan {
  readonly finalized: true;
  readonly id: string;
  readonly player: PlayerId;
  readonly source: ObjectRef;
  readonly printed: { readonly energy: number | null; readonly power: number | readonly Domain[] | null };
  readonly base: CostAmount | null;
  readonly components: readonly CostComponent[];
  readonly selectedAdditional: readonly { readonly id: string; readonly kind: OptionalCostInput['kind'] }[];
  readonly declinedAdditional: readonly string[];
  readonly modifications: readonly BaseCostModification[];
  readonly discounts: readonly AppliedCostDiscount[];
  readonly stages: readonly CostStage[];
  readonly total: CostAmount;
}

export interface CostPaymentOptions {
  readonly power?: DuelPaymentPlan;
  readonly nonstandardOrder?: readonly string[];
  /**
   * Optional caller-owned transaction boundary for Finalize.  The cost layer
   * cannot snapshot a ResolveContext itself, but a production Chain/Finalize
   * owner can provide its atomic wrapper here so a late replaced/prevented
   * payment rolls back every earlier payment action as one unit.
   */
  readonly transaction?: <T>(run: () => T) => T;
}

export interface PreparedCostAction {
  readonly id: string;
  readonly action: GameAction;
}

export interface PreparedCostPayment {
  readonly planId: string;
  readonly player: PlayerId;
  readonly power: DuelPaymentPlan;
  readonly actions: readonly PreparedCostAction[];
}

export type CostPaymentAssessment =
  | { readonly payable: true; readonly prepared: PreparedCostPayment }
  | { readonly payable: false; readonly error: CostPlanError };

export interface CostPaymentReceipt {
  readonly planId: string;
  readonly player: PlayerId;
  readonly paid: true;
  readonly total: CostAmount;
  readonly power: DuelPaymentPlan;
  readonly additional: readonly { readonly id: string; readonly kind: OptionalCostInput['kind']; readonly paid: true }[];
  readonly choices?: readonly CostChoiceReceipt[];
  readonly actions: readonly { readonly id: string; readonly action: GameAction; readonly status: 'done' | 'replaced' }[];
  readonly events: readonly GameEvent[];
}

export class CostPlanError extends Error {
  constructor(
    readonly reason: 'judge-required' | 'missing-printed-cost' | 'invalid-cost-plan' | 'cannot-pay-cost',
    message: string,
    readonly failedAction?: PreparedCostAction,
    readonly outcome?: ActionOutcome
  ) {
    super(message);
    this.name = 'CostPlanError';
  }
}
