import type { ActionOutcome, InstructionDef, InstructionResult, ObjectRef, PlayerId, Value } from "../contract.js";
import { AwaitChoice } from "../contract.js";
import type { TestWorld } from "./test-kernel.js";
import { ContractActionRollbackError } from "../../events/contract-actions/bridge.js";

export interface RunInstructionOptions {
  world: TestWorld;
  targets?: Record<string, readonly ObjectRef[]>;
  picks?: Record<string, readonly (ObjectRef | PlayerId | string)[]>;
  answers?: Record<string, unknown>;
  linked?: Record<string, Value>;
}
export interface RunInstructionResult {
  readonly result: InstructionResult | null;
  readonly events: readonly unknown[];
  readonly world: TestWorld;
  readonly linked: Readonly<Record<string, Value>>;
  readonly asked: AwaitChoice | null;
}

/** Execute one primitive transactionally, replaying it when an answer is supplied. */
export function runInstruction<A>(def: InstructionDef<A>, args: A, options: RunInstructionOptions): RunInstructionResult {
  const targetWorld = options.world.clone();
  const initialEventCount = targetWorld.events.length;
  for (const [id, refs] of Object.entries(options.targets ?? {})) targetWorld.setTargets(id, refs);
  for (const [id, picks] of Object.entries(options.picks ?? {})) targetWorld.setPicks(id, picks);
  targetWorld.setAnswers(options.answers ?? {});
  for (const [key, value] of Object.entries(options.linked ?? {})) targetWorld.link(key, value);
  try {
    const result = def.execute(targetWorld, def.argsSchema.parse(args));
    options.world.restore(targetWorld.snapshot());
    options.world.copyLinkedFrom(targetWorld);
    return { result, events: targetWorld.events.slice(initialEventCount), world: options.world, linked: linkedRecord(targetWorld), asked: null };
  } catch (error) {
    // A rejected contract batch is a completed primitive outcome only after the
    // caller-visible world has been restored to its pre-instruction checkpoint.
    if (error instanceof ContractActionRollbackError) {
      const outcome: ActionOutcome = error.outcome;
      if (outcome.status !== 'done' && outcome.receipt?.status === 'rolled-back') {
        options.world.restore(targetWorld.snapshot());
        options.world.copyLinkedFrom(targetWorld);
        const result: InstructionResult = {
          status: 'negated',
          reason: outcome.status === 'replaced' ? 'replaced' :
            outcome.status === 'prevented' ? 'skipped' : 'impossible',
          events: [...outcome.events],
        };
        return { result, events: targetWorld.events.slice(initialEventCount), world: options.world, linked: linkedRecord(targetWorld), asked: null };
      }
    }
    if (!(error instanceof AwaitChoice)) throw error;
    return { result: null, events: options.world.events, world: options.world, linked: linkedRecord(options.world), asked: error };
  }
}
function linkedRecord(world: TestWorld): Readonly<Record<string, Value>> { return world.linkedSnapshot(); }
