import type { V2ChoiceAnswer, V2ChooseCommand, V2Command } from '../../../protocol/dist/v2/commands.js';
import { isV2Command } from '../../../protocol/dist/v2/command-guards.js';
import { ChoiceMemory, type ChoiceMemorySnapshot } from '../chain/finalize/choice-memory.js';
import { AwaitChoice, type ChoiceRequest, type ObjectRef, type PlayerId, type ResolveContext } from '../effects/contract.js';
import { executeGameCommand, type GameCommandExecution } from './commands/index.js';
import type { Match, MatchHost } from './lifecycle.js';

/** Match-level command adapter over the real game command and Chain path. */
export interface MatchCommandAdapterOptions {
  readonly match: Match;
  readonly stateVersion: number;
  /** An outer journal may observe only accepted commands. */
  readonly onCommand?: (record: MatchCommandRecord, receipt: GameCommandExecution) => void;
}

export interface MatchChoiceAnswer {
  readonly choiceId: string;
  readonly answer: V2ChoiceAnswer;
}

/** Stable continuation identity used by CommandResult and later replay. */
export interface MatchChoiceCursor {
  readonly version: number;
  readonly choiceId: string;
}

export interface MatchPendingChoice {
  readonly commandId: string;
  readonly playerId: PlayerId;
  readonly request: ChoiceRequest<unknown>;
  readonly command: V2Command;
  readonly answers: readonly MatchChoiceAnswer[];
}

export interface MatchCommandRecord {
  readonly playerId: PlayerId;
  readonly command: V2Command;
}

export interface MatchCommandSnapshot {
  readonly stateVersion: number;
  readonly choiceMemory: ChoiceMemorySnapshot;
  readonly pending: MatchPendingChoice | null;
  readonly records: readonly MatchCommandRecord[];
}

export interface MatchReplayResult {
  readonly recordCount: number;
  readonly stateVersion: number;
  readonly choiceCursor: MatchChoiceCursor | null;
}

export interface MatchCommandAdapter {
  readonly stateVersion: number;
  readonly pendingChoice: MatchPendingChoice | null;
  execute(playerId: PlayerId, command: unknown): GameCommandExecution;
  snapshot(): MatchCommandSnapshot;
  restore(snapshot: MatchCommandSnapshot): void;
  replay(records: readonly MatchCommandRecord[]): MatchReplayResult;
  detach(): void;
}

export class MatchCommandError extends Error {
  readonly name = 'MatchCommandError';
  constructor(
    readonly code: 'card-program-binding' | 'choice-cursor' | 'command-in-progress' | 'invalid-command' | 'unknown-player',
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

type ContextChoice = MatchHost['context'];

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
    command: structuredClone(pending.command),
    answers: [...pending.answers].map(([choiceId, answer]) => ({
      choiceId,
      answer: structuredClone(answer) as V2ChoiceAnswer,
    })),
  };
}

class MatchCommand implements MatchCommandAdapter {
  private version: number;
  private pending: PendingInternal | null = null;
  private cursor: ChoiceRequest<unknown> | null = null;
  private answers: Map<string, unknown> | null = null;
  private readonly records: MatchCommandRecord[] = [];
  private readonly originalRecords: MatchCommandRecord[] = [];
  private readonly onCommand?: MatchCommandAdapterOptions['onCommand'];
  private readonly host: Match['flow']['chain']['pipeline']['host'];
  private readonly chainHost: Match['flow']['chain']['pipeline']['host'];
  private readonly originalContext: ContextChoice;
  private originalChainContext: Match['flow']['chain']['pipeline']['host']['context'];
  private readonly lifecycle: ReturnType<NonNullable<Match['programBinding']>['attachLifecycle']>;

  constructor(private readonly match: Match, stateVersion: number, onCommand?: MatchCommandAdapterOptions['onCommand']) {
    if (!Number.isSafeInteger(stateVersion) || stateVersion < 0) throw new TypeError('stateVersion must be a non-negative integer');
    if (match.programBinding === undefined) throw new MatchCommandError('card-program-binding', 'A trusted card-program registry is required');
    this.version = stateVersion;
    this.onCommand = onCommand;
    this.host = match.flow.options.host;
    this.chainHost = match.flow.chain.pipeline.host;
    this.originalContext = this.host.context;
    this.originalChainContext = this.chainHost.context;
    this.host.context = (source, controller, timingPoint) => this.context(this.originalContext, source, controller, timingPoint);
    this.chainHost.context = (source, controller, timingPoint) => this.context(this.originalChainContext, source, controller, timingPoint);
    this.lifecycle = this.match.programBinding!.attachLifecycle(this.match.flow.chain, error => { throw error; });
  }

  get stateVersion(): number { return this.version; }
  get pendingChoice(): MatchPendingChoice | null { return publicPending(this.pending); }

  execute(playerId: PlayerId, input: unknown): GameCommandExecution {
    if (!this.match.turnOrder.includes(playerId)) throw new MatchCommandError('unknown-player', 'Unknown player');
    if (!isV2Command(input)) throw new MatchCommandError('invalid-command', 'Invalid protocol v2 command');
    if (input.stateVersion !== this.version) throw new Error(`stateVersion mismatch: expected ${this.version}, received ${input.stateVersion}`);
    if (input.type === 'choose') return this.resume(playerId, input);
    if (this.pending !== null) {
      throw new MatchCommandError('command-in-progress', 'A command is waiting for a choice');
    }
    return this.run(playerId, input);
  }

  snapshot(): MatchCommandSnapshot {
    return {
      stateVersion: this.version,
      choiceMemory: chainChoiceMemory(this.match).snapshot(),
      pending: this.pendingChoice,
      records: structuredClone(this.records),
    };
  }

  restore(snapshot: MatchCommandSnapshot): void {
    if (!Number.isSafeInteger(snapshot.stateVersion) || snapshot.stateVersion < 0) throw new TypeError('Invalid command snapshot version');
    this.version = snapshot.stateVersion;
    chainChoiceMemory(this.match).restore(snapshot.choiceMemory);
    this.cursor = null;
    this.answers = null;
    this.records.splice(0, this.records.length, ...structuredClone(snapshot.records));
    this.pending = snapshot.pending === null ? null : {
      command: structuredClone(snapshot.pending.command),
      playerId: snapshot.pending.playerId,
      request: structuredClone(snapshot.pending.request),
      answers: new Map(snapshot.pending.answers.map(answer => [answer.choiceId, structuredClone(answer.answer)])),
    };
  }

  replay(records: readonly MatchCommandRecord[]): MatchReplayResult {
    this.originalRecords.splice(0, this.originalRecords.length, ...structuredClone(records));
    for (const record of records) {
      this.execute(record.playerId, { ...structuredClone(record.command), stateVersion: this.version });
    }
    return {
      recordCount: this.originalRecords.length,
      stateVersion: this.version,
      choiceCursor: this.pending === null || !this.originalRecords.some(record => record.command.type === 'choose') ? null : {
        version: this.version,
        choiceId: this.pending.request.id,
      },
    };
  }

  detach(): void {
    this.host.context = this.originalContext;
    this.chainHost.context = this.originalChainContext;
    this.cursor = null;
    this.answers = null;
    this.lifecycle.detach();
  }

  private context(base: ContextChoice, source: Parameters<ContextChoice>[0], controller: PlayerId, timingPoint: Parameters<ContextChoice>[2]): ResolveContext {
    const context = base(source, controller, timingPoint);
    return new Proxy(context, {
      get: (target, key) => {
        if (key !== 'choose') {
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return <T>(request: ChoiceRequest<T>): T => {
          if (this.cursor !== null) throw new Error('Choice cursor already holds a pending request');
          if (this.answers?.has(request.id)) return structuredClone(this.answers.get(request.id)) as T;
          this.cursor = request as ChoiceRequest<unknown>;
          throw new AwaitChoice(request);
        };
      },
    });
  }

  private run(playerId: PlayerId, command: V2Command): GameCommandExecution {
    const binding = this.match.programBinding!;
    this.cursor = null;
    this.answers = new Map();
    try {
      const receipt = executeGameCommand({ match: this.match, stateVersion: this.version, binding }, playerId, command);
      this.version += 1;
      this.record(playerId, command, receipt);
      this.answers = null;
      return receipt;
    } catch (error) {
      if (error instanceof AwaitChoice) {
        const request = this.cursor ?? error.request;
        const receipt = this.pendingReceipt(command);
        this.record(playerId, command, receipt);
        this.pending = { command, playerId, request: request as ChoiceRequest<unknown>, answers: this.answers ?? new Map() };
        this.cursor = null;
        return receipt;
      }
      this.cursor = null;
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
    const normalized = normalizeAnswer(pending.request, command.answer);
    if (!normalized.found) throw new MatchCommandError('choice-cursor', 'Choice answer is invalid');
    pending.answers.set(pending.request.id, structuredClone(normalized.value));
    this.answers = pending.answers;
    this.pending = null;
    this.cursor = null;
    try {
      const receipt = executeGameCommand({
        match: this.match,
        stateVersion: this.version,
        binding: this.match.programBinding!,
      }, playerId, pending.command);
      this.version += 1;
      this.record(playerId, command, receipt);
      this.answers = null;
      return receipt;
    } catch (error) {
      if (error instanceof AwaitChoice) {
        const request = this.cursor ?? error.request;
        const receipt = this.pendingReceipt(command);
        this.record(playerId, command, receipt);
        this.pending = {
          command: pending.command,
          playerId: pending.playerId,
          request: request as ChoiceRequest<unknown>,
          answers: pending.answers,
        };
        this.cursor = null;
        return receipt;
      }
      this.cursor = null;
      this.answers = null;
      this.pending = pending;
      throw error;
    }
  }

  private record(playerId: PlayerId, command: V2Command, receipt: GameCommandExecution): void {
    const record = { playerId, command: structuredClone(command) };
    this.records.push(record);
    this.onCommand?.(structuredClone(record), receipt);
  }

  private pendingReceipt(command: V2Command): GameCommandExecution {
    const eventSeq = this.match.events().length;
    return {
      commandId: command.commandId,
      type: command.type,
      previousEventSeq: eventSeq,
      eventSeq,
      winnerPlayerId: this.match.result().winner,
    };
  }
}

interface NormalizedAnswer {
  readonly found: boolean;
  readonly value?: unknown;
}

function normalizeAnswer(request: ChoiceRequest<unknown>, answer: unknown): NormalizedAnswer {
  if (request.type === 'optional') return typeof answer === 'boolean' ? { found: true, value: answer } : { found: false };
  if (request.type === 'mode') return request.options.includes(answer) ? { found: true, value: answer } : { found: false };
  if (request.type === 'number') return typeof answer === 'number' && Number.isSafeInteger(answer) && answer >= request.min && answer <= request.max
    ? { found: true, value: answer }
    : { found: false };
  if (!Array.isArray(answer)) return { found: false };
  const min = request.type === 'select-objects' ? request.min : request.options.length;
  const max = request.type === 'select-objects' ? request.max : request.options.length;
  if (answer.length < min || answer.length > max) return { found: false };
  const keys = new Set<string>();
  const normalized: ObjectRef[] = [];
  for (const value of answer) {
    if (value === null || typeof value !== 'object') return { found: false };
    const object = value as { readonly id?: unknown; readonly objectId?: unknown; readonly zoneEntryId?: unknown };
    const id = typeof object.id === 'string' ? object.id : object.objectId;
    if (typeof id !== 'string' || !Number.isSafeInteger(object.zoneEntryId) || Number(object.zoneEntryId) < 0) return { found: false };
    const key = `${id}:${String(object.zoneEntryId)}`;
    if (keys.has(key)) return { found: false };
    keys.add(key);
    normalized.push({ id, zoneEntryId: Number(object.zoneEntryId) });
  }
  const options = new Set(request.options.map(ref => `${ref.id}:${ref.zoneEntryId}`));
  if (![...keys].every(key => options.has(key))) return { found: false };
  return { found: true, value: normalized };
}

export function createMatchCommandAdapter(options: MatchCommandAdapterOptions): MatchCommandAdapter {
  return new MatchCommand(options.match, options.stateVersion, options.onCommand);
}

