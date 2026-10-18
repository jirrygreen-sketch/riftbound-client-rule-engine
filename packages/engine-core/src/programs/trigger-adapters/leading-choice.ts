import type { CostPlanInput } from '../../cost/plan-types.js';
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

const isEffectInstruction = (instruction: unknown): boolean => isRecord(instruction) && typeof (instruction as { op?: unknown }).op === 'string' && String((instruction as { op?: unknown }).op).startsWith('effect.');

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

/** Rewrite instruction args so symbolic links into the removed cost.pay stay resolvable. */
function stripCostLinks(instruction: Instruction, costId: string): Instruction {
  const next = { ...instruction };
  if (next.linkedTo === costId) {
    const { linkedTo: _removed, ...withoutLink } = next as Instruction & { readonly linkedTo?: string };
    return withoutLink as Instruction;
  }
  if (next.args === undefined) return next;
  next.args = Object.fromEntries(Object.entries(next.args).map(([key, expression]) => {
    if (isRecord(expression) && ['linked', 'linked-value'].includes(String(expression.kind)) && (expression as Record<string, unknown>).instructionId === costId) {
      return [key, { kind: 'constant', value: null }];
    }
    return [key, expression];
  }));
  return next;
}

/**
 * Move a leading choice.optional to Finalize (CR 383.3.a). A body without a
 * leading cost keeps its effect instructions unchanged. A leading cost.pay is
 * also moved into the registration CostPlan (CR 383.3.b.1); its receipt is
 * linked under the removed instruction id and the instruction is dropped from
 * Resolve so it cannot be paid twice.
 *
 * The adapter covers only the evaluated constant-array effect spelling. A
 * leading choice with any other nested operation is not a safe executable
 * interpretation and must fail closed instead of falling back to the scan-time
 * optional question.
 */
export function adaptLeadingChoice(
  source: ObjectSnapshot,
  body: readonly Instruction[]
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
  if (!rest.length || !rest.every(isEffectInstruction)) return undefined;
  const cost = costPayArgsToCostSpec(first.args);
  if (!cost) return undefined;
  const adapted = rest.map(instruction => hoistTargets(stripCostLinks(instruction, first.id)));
  return {
    mayAtFinalize: true,
    cost: { id: `cost:${source.ref.id}:${source.ref.zoneEntryId}:${choice.id}`, cost },
    body: adapted.map(entry => entry.instruction),
    targets: adapted.flatMap(entry => entry.targets.map(requirement => ({ requirement })))
  };
}
