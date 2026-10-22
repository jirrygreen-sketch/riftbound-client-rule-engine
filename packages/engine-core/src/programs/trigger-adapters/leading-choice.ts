import type { CostPlanInput, LeadingCostReceiptBinding } from '../../cost/plan-types.js';
import type { Instruction, ObjectSnapshot } from '../../effects/contract.js';
import type { TargetRequirement } from '../../target/target-plan.js';
import { costPayArgsToCostSpec } from './finalize-cost.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const constantArray = (expression: unknown): readonly unknown[] | undefined =>
  isRecord(expression) && ['constant', 'literal'].includes(String(expression.kind)) && Array.isArray(expression.value)
    ? expression.value as readonly unknown[]
    : undefined;

export const isCostPay = (instruction: unknown): instruction is Instruction & { readonly args: Record<string, unknown> } =>
  isRecord(instruction) && (instruction as { op?: unknown }).op === 'cost.pay' && isRecord((instruction as { args?: unknown }).args);

/**
 * A leading cost is removed from Resolve after Finalize pays it. Keep an
 * explicit bridge under the authored instruction id so Resolve can read the
 * exact cost receipt without reviving or paying the instruction again.
 */
export const LEADING_COST_RECEIPT_LINK = '__riftbound.leading-cost-receipt' as const;

const hasNestedControlBody = (instruction: Instruction): boolean => {
  const body = instruction.args?.body;
  if (!isRecord(body) || !('value' in body)) return false;
  return ['constant', 'literal'].includes(String(body.kind)) && Array.isArray(body.value);
};

function hoistTargets(instruction: Instruction): { readonly instruction: Instruction; readonly targets: readonly TargetRequirement[] } {
  if (!instruction.targets?.length) return { instruction, targets: [] };
  const { targets: _hoisted, ...withoutTargets } = instruction as Instruction & { readonly targets?: readonly TargetRequirement[] };
  return { instruction: withoutTargets as Instruction, targets: instruction.targets as readonly TargetRequirement[] };
}

type CostReference = 'none' | 'receipt' | 'unsupported';

/** Deep linked selectors use the receipt bridge; direct linked-value reads remain unsupported. */
function costReference(value: unknown, instructionId: string): CostReference {
  if (Array.isArray(value)) {
    let result: CostReference = 'none';
    for (const item of value) {
      const reference = costReference(item, instructionId);
      if (reference === 'unsupported') return reference;
      if (reference === 'receipt') result = reference;
    }
    return result;
  }
  if (!isRecord(value)) return 'none';
  if (['linked', 'linked-value'].includes(String(value.kind)) && value.instructionId === instructionId) return 'unsupported';
  let result: CostReference = value.linked === instructionId ? 'receipt' : 'none';
  for (const item of Object.values(value)) {
    const reference = costReference(item, instructionId);
    if (reference === 'unsupported') return reference;
    if (reference === 'receipt') result = reference;
  }
  return result;
}

function instructionCostReference(instruction: Instruction, instructionId: string): CostReference {
  let result: CostReference = 'none';
  for (const value of Object.values(instruction.args)) {
    const reference = costReference(value, instructionId);
    if (reference === 'unsupported') return reference;
    if (reference === 'receipt') result = reference;
  }
  return result;
}

type ResolveInstruction = Instruction & { readonly leadingCostReceipt?: LeadingCostReceiptBinding };

function receiptBound(instruction: Instruction, binding: LeadingCostReceiptBinding): ResolveInstruction {
  return { ...instruction, leadingCostReceipt: binding } as ResolveInstruction;
}

function costChoiceIds(args: Record<string, unknown>): readonly string[] | undefined {
  const payments = constantArray(args.payments);
  if (payments === undefined) return undefined;
  const ids: string[] = [];
  for (const payment of payments) {
    if (!isRecord(payment) || payment.choice === undefined) continue;
    if (!isRecord(payment.choice) || typeof payment.choice.id !== 'string' || !payment.choice.id.length) return undefined;
    ids.push(payment.choice.id);
  }
  return ids.length ? [...new Set(ids)] : undefined;
}

function removePaymentGate(instruction: Instruction, instructionId: string): Instruction {
  if (instruction.linkedTo !== instructionId) return instruction;
  const { linkedTo: _paidGate, ...withoutGate } = instruction as Instruction & { readonly linkedTo?: string };
  return withoutGate as Instruction;
}

/**
 * Move a leading choice.optional to Finalize (CR 383.3.a). A body without a
 * leading cost keeps its effect instructions unchanged. A leading cost.pay is
 * also moved into the registration CostPlan (CR 383.3.b.1) and dropped from
 * Resolve so it cannot be paid twice. A pure linkedTo gate is safe because a
 * failed Finalize never resolves. Expressions that read the removed cost use
 * the explicit Resolve receipt link established below; all other reads fail
 * closed because no Resolve-scope result exists.
 *
 * The adapter covers only the evaluated constant-array effect spelling. A
 * leading choice with any other nested operation is not a safe executable
 * interpretation and must fail closed instead of falling back to the scan-time
 * optional question.
 */
export function adaptLeadingChoice(
  source: ObjectSnapshot,
  body: readonly Instruction[],
  trigger?: { readonly at?: string; readonly filter?: unknown }
): {
  readonly mayAtFinalize: true;
  readonly cost?: CostPlanInput;
  readonly body: readonly Instruction[];
  readonly targets: readonly { readonly requirement: TargetRequirement }[];
} | undefined {
  if (body.length !== 1) return undefined;
  const choice = body[0]!;
  if (choice.op !== 'choice.optional') return undefined;
  const args = isRecord(choice.args) ? choice.args as Record<string, unknown> : undefined;
  if (!args) return undefined;
  const nested = constantArray(args.body);
  if (!nested?.length) return undefined;
  const [first, ...rest] = nested as readonly Instruction[];
  if (!isCostPay(first)) {
    const instructions = nested as readonly Instruction[];
    if (instructions.some(hasNestedControlBody)) return undefined;
    const adapted = instructions.map(instruction => hoistTargets(instruction));
    return {
      mayAtFinalize: true,
      body: adapted.map(entry => entry.instruction),
      targets: adapted.flatMap(entry => entry.targets.map(requirement => ({ requirement })))
    };
  }
  if (!rest.length || rest.some(hasNestedControlBody)) return undefined;
  const references = rest.map(instruction => instructionCostReference(instruction, first.id));
  if (references.includes('unsupported')) return undefined;
  const needsReceipt = references.includes('receipt');
  const choiceIds = costChoiceIds(first.args);
  if (needsReceipt && !choiceIds) return undefined;
  const binding: LeadingCostReceiptBinding | undefined = needsReceipt ? {
    instructionId: first.id,
    link: LEADING_COST_RECEIPT_LINK,
    choiceIds: choiceIds!
  } : undefined;
  // event:it is a frozen referent, but effect.ready's primitive schema cannot
  // consume it until the 835 chain bridge supplies the binding. Do not turn
  // the card's target into a player-selected TargetSpec or claim success.
  if (trigger?.at === 'buff-added' && rest.some(instruction => instruction.op === 'effect.ready')) return undefined;
  const cost = costPayArgsToCostSpec(first.args);
  if (!cost) return undefined;
  const adapted = rest.map(instruction => {
    const ungated = removePaymentGate(instruction, first.id);
    const bridged = binding !== undefined && instructionCostReference(ungated, first.id) === 'receipt'
      ? receiptBound(ungated, binding) : ungated;
    return hoistTargets(bridged);
  });
  return {
    mayAtFinalize: true,
    cost: { id: `cost:${source.ref.id}:${source.ref.zoneEntryId}:${choice.id}`, cost },
    body: adapted.map(entry => entry.instruction),
    targets: adapted.flatMap(entry => entry.targets.map(requirement => ({ requirement })))
  };
}
