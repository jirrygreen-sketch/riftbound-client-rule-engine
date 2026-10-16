export type ProgramBindingErrorCode =
  | 'judge-required'
  | 'unknown-program'
  | 'invalid-program'
  | 'unbound-ability';

export class ProgramBindingError extends Error {
  readonly name = 'ProgramBindingError';
  constructor(readonly code: ProgramBindingErrorCode, message: string, readonly detail?: unknown) {
    super(message);
  }
}

export function judgeRequired(message: string, detail?: unknown): never {
  throw new ProgramBindingError('judge-required', message, detail);
}
