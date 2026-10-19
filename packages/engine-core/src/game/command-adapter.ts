import type { V2Command, V2ChooseCommand } from '../../../protocol/dist/v2/commands.js';
import { isV2Command } from '../../../protocol/dist/v2/command-guards.js';
import { ChoiceMemory, type ChoiceMemorySnapshot } from '../chain/finalize/choice-memory.js';
import { AwaitChoice, type ChoiceRequest, type ObjectRef, type PlayerId } from '../effects/contract.js';
import { executeGameCommand, type GameCommandExecution } from './commands/index.js';
import type { Match } from './lifecycle.js';

/** Match-level command adapter over the authoritative Match/Chain path. */
export interface MatchCommandAdapterOptions {
  readonly match: Match;
  /** Current externally owned state version. */
  readonly stateVersion: number;
}

export interface MatchCommandSnapshot {
  readonly stateVersion: number;
  readonly choiceMemory: ChoiceMemorySnapshot;
  readonly pending: MatchPendingChoice | null;
}

export interface MatchPendingChoice {
  readonly commandId: string;
  readonly playerId: PlayerId;
  readonly request: ChoiceRequest<unknown>;
}

export interface MatchCommandAdapter {
  readonly stateVersion: number;
  readonly pendingChoice: MatchPendingChoice | null;
  execute(playerId: PlayerId, command: unknown): GameCommandExecution;
  snapshot(): MatchCommandSnapshot;
  detach(): void;
}

export class MatchCommandError extends Error {
  readonly name = 'MatchCommandError';
  constructor(
    readonly code: 'card-program-binding' | 'choice-cursor' | 'command-in-progress' | 'unknown-player',
    message: string,
  ) { super(message); }
}

interface PendingInternal {
  readonly command: V2Command;
  readonly playerId: PlayerId;
  readonly request: ChoiceRequest<unknown>;
  readonly answers: Map<string, unknown>;
}

interface ChoiceMemoryCarrier {
  readonly choiceMemory: ChoiceMemory;
}

/** The Chain owns the mode-memory ledger; this adapter snapshots its public snapshot. */
function chainChoiceMemory(match: Match): ChoiceMemory {
  const carrier = match.flow.chain as unknown as Partial<ChoiceMemoryCarrier>;
  if (!(carrier.choiceMemory instanceof ChoiceMemory)) {
    throw new MatchCommandError('choice-cursor', 'The match Chain does not expose ChoiceMemory');
  }
  return carrier.choiceMemory;
}

function publicPending(pending: PendingInternal | null): MatchPendingChoice | null {
  return pending === null ? null : {
    commandId: pending.command.commandId,
    playerId: pending.playerId,
    request: structuredClone(pending.request),
  };
}

class MatchCommand implements MatchCommandAdapter {
  private version: number;
  private pending: PendingInternal | null = null;
  private pendingRequest: ChoiceRequest<unknown> | null = null;
  private answers: Map<string, unknown> | null = null;
  private readonly originalChoose: Match['flow']['options']['host']['choose'];

  constructor(private readonly match: Match, stateVersion: number) {
    if (!Number.isSafeInteger(stateVersion) || stateVersion < 0) throw new TypeError('stateVersion must be a non-negative integer');
    if (match.programBinding === undefined) throw new MatchCommandError('card-program-binding', 'A trusted card-program registry is required');
    this.version = stateVersion;
    const host = match.flow.options.host;
    this.originalChoose = host.choose;
    host.choose = <T>(request: ChoiceRequest<T>): T => {
      if (this.pendingRequest !== null) throw new Error('Choice cursor already holds a pending request');
      if (this.answers?.has(request.id)) return structuredClone(this.answers.get(request.id)) as T;
      this.pendingRequest = request as ChoiceRequest<unknown>;
      throw new AwaitChoice(request);
    };
  }

  get stateVersion(): number { return this.version; }
  get pendingChoice(): MatchPendingChoice | null { return publicPending(this.pending); }

  execute(playerId: PlayerId, input: unknown): GameCommandExecution {
    if (!this.match.turnOrder.includes(playerId)) throw new MatchCommandError('unknown-player', 'Unknown player');
    if (!isV2Command(input)) throw new MatchCommandError('choice-cursor', 'Invalid protocol v2 command');
    if (input.stateVersion !== this.version) throw new Error(`stateVersion mismatch: expected ${this.version}, received ${input.stateVersion}`);
    if (input.type === 'choose') return this.resume(playerId, input);
    if (this.pending !== null) throw new MatchCommandError('command-in-progress', 'A command is waiting for a choice');
    return this.run(playerId, input);
  }

  snapshot(): MatchCommandSnapshot {
    return {
      stateVersion: this.version,
      choiceMemory: chainChoiceMemory(this.match).snapshot(),
      pending: this.pendingChoice,
    };
  }

  detach(): void {
    this.match.flow.options.host.choose = this.originalChoose;
    this.pendingRequest = null;
    this.answers = null;
  }

  private run(playerId: PlayerId, command: V2Command): GameCommandExecution {
    const binding = this.match.programBinding!;
    this.pendingRequest = null;
    this.answers = this.pending?.answers ?? new Map();
    try {
      const receipt = executeGameCommand({ match: this.match, stateVersion: this.version, binding }, playerId, command);
      this.version += 1;
      this.pending = null;
      this.answers = null;
      return receipt;
    } catch (error) {
      if (error instanceof AwaitChoice) {
        const request = this.pendingRequest ?? error.request;
        this.pending = { command, playerId, request: request as ChoiceRequest<unknown>, answers: this.answers ?? new Map() };
        this.pendingRequest = null;
        return {
          commandId: command.commandId,
          type: command.type,
          previousEventSeq: this.match.events().length,
          eventSeq: this.match.events().length,
          winnerPlayerId: this.match.result().winner,
        };
      }
      this.pendingRequest = null;
      this.answers = null;
      throw error;
    }
  }

  private resume(playerId: PlayerId, command: V2ChooseCommand): GameCommandExecution {
    const pending = this.pending;
    if (pending === null) throw new MatchCommandError('choice-cursor', 'No choice is pending');
    if (pending.playerId !== playerId || pending.request.chooser !== playerId || pending.request.id !== command.choiceId) {
      throw new MatchCommandError('choice-cursor', 'Choice is not owned by this player');
    }
    if (!validAnswer(pending.request, command.answer)) throw new MatchCommandError('choice-cursor', 'Choice answer is invalid');
    pending.answers.set(pending.request.id, structuredClone(command.answer));
    this.answers = pending.answers;
    this.pending = null;
    return this.run(playerId, pending.command);
  }
}

function validAnswer(request: ChoiceRequest<unknown>, answer: unknown): boolean {
  if (request.type === 'optional') return typeof answer === 'boolean';
  if (request.type === 'mode') return request.options.includes(answer);
  if (request.type === 'number') return typeof answer === 'number' && Number.isSafeInteger(answer) && answer >= request.min && answer <= request.max;
  if (!Array.isArray(answer)) return false;
  const min = request.type === 'select-objects' ? request.min : request.options.length;
  const max = request.type === 'select-objects' ? request.max : request.options.length;
  if (answer.length < min || answer.length > max) return false;
  const keys = new Set<string>();
  for (const value of answer) {
    if (value === null || typeof value !== 'object') return false;
    const object = value as Partial<ObjectRef>;
    if (typeof object.id !== 'string' || !Number.isSafeInteger(object.zoneEntryId) || Number(object.zoneEntryId) < 0) return false;
    const key = `${object.id}:${String(object.zoneEntryId)}`;
    if (keys.has(key)) return false;
    keys.add(key);
  }
  const options = new Set(request.options.map(ref => `${ref.id}:${ref.zoneEntryId}`));
  return [...keys].every(key => options.has(key));
}

export function createMatchCommandAdapter(options: MatchCommandAdapterOptions): MatchCommandAdapter {
  return new MatchCommand(options.match, options.stateVersion);
}

