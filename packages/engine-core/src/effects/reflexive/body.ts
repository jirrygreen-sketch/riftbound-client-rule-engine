import type { Instruction } from '../contract.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const constantArray = (value: unknown): readonly Instruction[] | undefined => {
  if (!isRecord(value) || !['constant', 'literal'].includes(String(value.kind)) || !Array.isArray(value.value)) {
    return undefined;
  }
  return isInstructionArray(value.value) ? value.value : undefined;
};

export function isInstruction(value: unknown): value is Instruction {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0 &&
    typeof value.op === 'string' && value.op.length > 0 && isRecord(value.args);
}

export function isInstructionArray(value: unknown): value is readonly Instruction[] {
  return Array.isArray(value) && value.every(isInstruction);
}

/**
 * CR v1.5 388.4: a leading "you may" is decided when the Reflexive Trigger
 * finalizes.  The existing trigger adapter uses the same representation for a
 * leading may, so retain its body while moving only the decision to the new
 * Pending Item.  Nested may/cost shapes remain on their own Finalize surface.
 */
export function normalizeReflexiveBody(body: readonly Instruction[]): {
  readonly body: readonly Instruction[];
  readonly mayAtFinalize: boolean;
} {
  if (body.length !== 1 || body[0]?.op !== 'choice.optional') {
    return { body, mayAtFinalize: false };
  }
  const nested = constantArray(body[0].args.body);
  if (nested === undefined || nested.length === 0) {
    throw new TypeError('trigger.reflexive leading may must contain an instruction body');
  }
  return { body: nested, mayAtFinalize: true };
}

/**
 * The original trigger body contains the unresolved declaration.  It is not a
 * nested target of the trigger itself: CR 355.5.b gives the declaration to the
 * new item's own Finalize.  Validate that body now, then remove only the
 * unresolved declaration from the parent item.
 */
export function parentBodyWithoutReflexiveDeclarations(body: readonly Instruction[]): readonly Instruction[] {
  return body.filter(instruction => instruction.op !== 'trigger.reflexive');
}

function encodeInstruction(instruction: Instruction): Instruction {
  const args = { ...instruction.args };
  if (instruction.op === 'trigger.reflexive') {
    const expression = args.body;
    if (expression && ['constant', 'literal'].includes(String(expression.kind)) &&
        Array.isArray((expression as { readonly value?: unknown }).value)) {
      const values = (expression as { readonly value: readonly Instruction[] }).value;
      args.body = {
        ...expression,
        value: { reflexiveInstructions: values.map(encodeInstruction) as unknown as import('../contract.js').Value },
      } as Instruction['args'][string];
    }
  } else {
    const expression = args.body;
    if (expression && ['constant', 'literal'].includes(String(expression.kind)) &&
        Array.isArray((expression as { readonly value?: unknown }).value)) {
      const values = (expression as { readonly value: readonly Instruction[] }).value;
      args.body = {
        ...expression,
        value: values.map(encodeInstruction),
      } as Instruction['args'][string];
    }
    const modes = args.modes;
    if (expression && modes && ['constant', 'literal'].includes(String(modes.kind)) &&
        Array.isArray((modes as { readonly value?: unknown }).value)) {
      const values = (modes as { readonly value: readonly Record<string, unknown>[] }).value;
      args.modes = {
        ...modes,
        value: values.map((mode: Record<string, unknown>) => isRecord(mode) && Array.isArray(mode.body)
          ? { ...mode, body: mode.body.map(encodeInstruction) }
          : mode),
      } as Instruction['args'][string];
    }
  }
  return { ...instruction, args };
}

/**
 * Registration-only encoding for the original card IR.  The Chain parent must
 * not inspect or choose the nested body declared by `trigger.reflexive`; that
 * body belongs to the new Pending Item's Finalize (CR 355.5.b).  Encoding the
 * declaration keeps the same raw program while the primitive receives the
 * original instruction array through `reflexiveInstructions`.
 */
export function encodeReflexiveRegistrationBody(body: readonly Instruction[]): readonly Instruction[] {
  return body.map(encodeInstruction);
}

/**
 * Replace only references to the result key supplied by `trigger.reflexive`.
 * The replacement is runtime-only and leaves the card program unchanged.
 */
export function rewriteReflexiveLinks(
  value: unknown,
  from: string,
  to: string,
  seen = new WeakMap<object, unknown>(),
): unknown {
  if (value === null || typeof value !== 'object') return value;
  const prior = seen.get(value);
  if (prior !== undefined) return prior;
  if (Array.isArray(value)) {
    const output: unknown[] = [];
    seen.set(value, output);
    for (const entry of value) output.push(rewriteReflexiveLinks(entry, from, to, seen));
    return output;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 1 && record.linked === from) return { ...record, linked: to };
  if ((record.kind === 'linked' || record.kind === 'linked-value') && record.instructionId === from) {
    return { ...record, instructionId: to };
  }
  if (record.kind === 'result' && record.result === from) return { ...record, result: to };
  const output: Record<string, unknown> = {};
  seen.set(value, output);
  for (const [key, entry] of Object.entries(record)) {
    output[key] = rewriteReflexiveLinks(entry, from, to, seen);
  }
  return output;
}
