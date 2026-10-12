export class PersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistenceError";
  }
}

export class IdempotencyConflictError extends PersistenceError {
  constructor(message: string) {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

export class PersistenceClosedError extends PersistenceError {
  constructor() {
    super("persistence store is closed");
    this.name = "PersistenceClosedError";
  }
}
