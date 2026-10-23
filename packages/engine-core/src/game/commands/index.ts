import { isV2Command } from '../../../../protocol/dist/v2/command-guards.js';
import type { V2ChooseCommand, V2Command, V2DeclareAttackCommand, V2DeclareDefenseCommand, V2MoveCommand } from '../../../../protocol/dist/v2/commands.js';
import { isJournalEntry } from '../../../../protocol/dist/journal-v1.js';
import type { ChainDraft } from '../../chain/engine.js';
import type { PlayerId } from '../../effects/contract.js';
import type { ProgramBinding } from '../../programs/index.js';
import { TurnCombatBlockedError } from '../../turn/flow.js';
import { concede } from '../lifecycle.js';
import { controlledObject, currentObjects, GameCommandError, moveUnits, requireActor, type GameCommandContext, type StandardMoveExecution } from './movement.js';

export { GameCommandError, inspectStandardMove, moveUnits } from './movement.js';
export type { GameCommandContext, StandardMoveInspection } from './movement.js';

export interface GameCommandExecutionContext extends GameCommandContext {
  /** Trusted registry, attached to this match's lifecycle by the state owner. */
  readonly binding?: ProgramBinding;
}

export interface GameCommandExecution {
  readonly commandId: string;
  readonly type: V2Command['type'];
  /** Exclusive/inclusive event cursors, respectively. No wire version is advanced here. */
  readonly previousEventSeq: number;
  readonly eventSeq: number;
  readonly winnerPlayerId: PlayerId | null;
}

function requireCurrentVersion(context: GameCommandContext, actor: PlayerId, stateVersion: number): void {
  requireActor(context, actor);
  if (!Number.isSafeInteger(context.stateVersion) || context.stateVersion < 0 || stateVersion !== context.stateVersion) {
    throw new GameCommandError('stale-version', 'State version mismatch');
  }
}

function validate(context: GameCommandContext, actor: PlayerId, command: unknown, expectedType?: V2Command['type']): asserts command is V2Command {
  if (!isV2Command(command) || expectedType !== undefined && command.type !== expectedType) {
    throw new GameCommandError('invalid-command', 'Invalid protocol v2 command');
  }
  requireCurrentVersion(context, actor, command.stateVersion);
}

/** Command IDs, unlike ProgramBinding's process-local draft sequence, survive replay. */
function commandDraft(command: V2Command, draft: ChainDraft): ChainDraft {
  const id = `game-command:${command.commandId}`;
  return { ...draft, id, ...(draft.cost ? { cost: { ...draft.cost, id: `cost:${id}` } } : {}) };
}

export function move(context: GameCommandContext, actor: PlayerId, command: V2MoveCommand): StandardMoveExecution {
  validate(context, actor, command, 'move');
  return moveUnits(context, actor, [command.objectId], command.to);
}

export function declareAttack(context: GameCommandContext, actor: PlayerId, command: V2DeclareAttackCommand): never {
  validate(context, actor, command, 'declare-attack');
  requireBattlefield(context, command.battlefieldId);
  // CR 466.2.c assigns all present Units automatically, not an arbitrary client-selected subset.
  throw new TurnCombatBlockedError('combat-start-transaction', 'Combat start, simultaneous Showdown start and automatic designations require a public rules task (CR v1.5 466.2)');
}

export function declareDefense(context: GameCommandContext, actor: PlayerId, command: V2DeclareDefenseCommand): never {
  validate(context, actor, command, 'declare-defense');
  requireBattlefield(context, command.battlefieldId);
  throw new TurnCombatBlockedError('combat-designation-task', 'Defender designation is automatic and has no public rules-task interface (CR v1.5 466.2.c)');
}

function requireBattlefield(context: GameCommandContext, id: string): void {
  if (!context.match.flow.battlefields.some(field => field.id === id)) throw new GameCommandError('unknown-battlefield', 'Unknown Battlefield');
}

/** Planned wire mapping is choose; no fake choice cursor or unchecked allocation is accepted. */
export function assignDamage(context: GameCommandContext, actor: PlayerId, command: V2ChooseCommand): never {
  validate(context, actor, command, 'choose');
  throw new TurnCombatBlockedError('combat-damage-choice', 'TurnFlow cannot issue a Combat allocation choice yet (CR v1.5 467.2.c)');
}

export function resolveCombatDamage(context: GameCommandContext): never {
  if (context.match.result().winner) throw new GameCommandError('game-over', 'Game is over');
  return context.match.flow.combat.dealDamage();
}

/**
 * Game-level dispatch only. The state owner authenticates actors and owns
 * idempotency, stateVersion advancement, choice suspension and durable journals.
 * Blocked/errors propagate so they cannot become accepted/no-op receipts.
 */
export function executeGameCommand(context: GameCommandExecutionContext, actor: PlayerId, input: unknown): GameCommandExecution {
  validate(context, actor, input);
  const command = input;
  const { match } = context;
  const previousEventSeq = match.events().length;
  switch (command.type) {
    case 'move': move(context, actor, command); break;
    case 'declare-attack': declareAttack(context, actor, command);
    case 'declare-defense': declareDefense(context, actor, command);
    case 'choose':
      throw new TurnCombatBlockedError('choice-continuation', 'Choices must resume the state owner\'s suspended operation');
    case 'mulligan':
      throw new GameCommandError('setup-complete', 'Mulligan belongs to createMatch setup');
    case 'play':
    case 'activate': {
      // Silently dropping selections would execute a different command than the client sent.
      if (command.cost !== undefined || command.targets !== undefined || command.picks !== undefined) {
        throw new TurnCombatBlockedError('command-selections', 'Wire cost/target/pick selections require a Finalize adapter');
      }
      if (!context.binding) throw new TurnCombatBlockedError('card-program-binding', 'A trusted card-program registry is required');
      const source = controlledObject(currentObjects(match), actor, command.type === 'play' ? command.cardObjectId : command.sourceObjectId);
      let draft: ChainDraft;
      if (command.type === 'play') {
        if (source.zone !== 'hand') throw new GameCommandError('illegal-play-zone', 'Play requires a card in your hand');
        draft = context.binding.describePlay({ type: 'play', player: actor, object: source.ref }, source);
      } else {
        const isLegend = source.types.some(type => type.toLowerCase() === 'legend');
        if (isLegend ? source.zone !== 'legend' : source.zone !== 'board') {
          throw new GameCommandError(
            'illegal-activation-zone',
            'Activation requires a board object or a Legend in the Legend Zone',
          );
        }
        const index = Number(command.abilityId);
        if (!Number.isSafeInteger(index) || index < 0 || String(index) !== command.abilityId) {
          throw new GameCommandError('unknown-ability', 'Unknown activated ability');
        }
        draft = context.binding.describeActivate(source, actor, index);
      }
      match.flow.execute(commandDraft(command, draft));
      break;
    }
    case 'pass': match.flow.pass(actor); break;
    case 'concede': concede(match, actor); break;
  }
  return { commandId: command.commandId, type: command.type, previousEventSeq, eventSeq: match.events().length, winnerPlayerId: match.result().winner };
}

/**
 * Compatibility adapter for a journal-v1 record whose enclosing journal has
 * already passed the protocol's integrity/sequence checks. Does not rewrite the
 * record or apply its stored receipts. The state owner skips duplicates and
 * advances versions; prompt continuations still need the real suspended task.
 */
export function executeJournalGameCommand(context: GameCommandExecutionContext, input: unknown): GameCommandExecution {
  if (!isJournalEntry(input)) throw new GameCommandError('invalid-journal-entry', 'Invalid journal-v1 command record');
  if (input.duplicate) throw new GameCommandError('journal-duplicate', 'The journal owner must skip duplicate records');
  const base = { commandId: input.commandId, stateVersion: input.expectedStateVersion };
  // Apply the same actor/end/version guard even to unsupported legacy commands.
  requireCurrentVersion(context, input.playerId, input.expectedStateVersion);
  switch (input.command.type) {
    case 'pass':
    case 'concede':
      return executeGameCommand(context, input.playerId, { ...base, type: input.command.type });
    case 'play-card':
      if (input.command.targets.length) {
        throw new TurnCombatBlockedError('command-selections', 'Legacy target selections require a Finalize adapter');
      }
      return executeGameCommand(context, input.playerId, { ...base, type: 'play', cardObjectId: input.command.instanceId });
    case 'respond-to-prompt':
      throw new TurnCombatBlockedError('choice-continuation', 'A legacy prompt must resume the state owner\'s suspended operation');
  }
}
