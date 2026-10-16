import { validateCardProgram, type CardProgram } from '@riftbound/card-dsl';
import { ProgramBindingError } from './errors.js';

export type ProgramSource = readonly CardProgram[] | ReadonlyMap<string, CardProgram>;

export class ProgramRegistry {
  private readonly programs: ReadonlyMap<string, CardProgram>;
  constructor(source: ProgramSource) {
    const entries: readonly (readonly [string, CardProgram])[] = source instanceof Map ? [...source.entries()] : (source as readonly CardProgram[]).map(program => [program.canonicalCardId, program] as const);
    const map = new Map<string, CardProgram>();
    for (const [id, program] of entries) {
      const result = validateCardProgram(program);
      if (!result.ok) throw new ProgramBindingError('invalid-program', `Invalid card program ${id}`, result.issues);
      if (map.has(id)) throw new ProgramBindingError('invalid-program', `Duplicate card program ${id}`);
      map.set(id, result.value);
    }
    this.programs = map;
  }
  get(cardId: string | null | undefined): CardProgram {
    if (!cardId || !this.programs.has(cardId)) throw new ProgramBindingError('unknown-program', `No CardProgram is registered for ${cardId ?? '<null>'}`);
    const program = this.programs.get(cardId)!;
    if (program.status === 'judge-required') throw new ProgramBindingError('judge-required', program.judgeReason ?? `Card program ${cardId} requires a judge`, program);
    if (program.status !== 'executable' && program.status !== 'no-ability') throw new ProgramBindingError('invalid-program', `Unsupported CardProgram status ${program.status}`, program);
    return program;
  }
  inspect(cardId: string | null | undefined): CardProgram | undefined { return cardId ? this.programs.get(cardId) : undefined; }
  has(cardId: string | null | undefined): boolean { return !!cardId && this.programs.has(cardId); }
}
