export type PlayerId = string;
export type RoomId = string;

export type GamePhase = "main" | "ended";

export interface PlayerIdentity {
  id: PlayerId;
  name: string;
}

export interface CardDefinition {
  id: string;
  name: string;
  cost: number;
}

export interface CardInstance {
  instanceId: string;
  cardId: string;
}

export interface PassPlayerCommand {
  type: "pass";
}

export interface PlayCardPlayerCommand {
  type: "play-card";
  instanceId: string;
  targets?: readonly CommandTarget[];
}

export type CommandTarget =
  | { kind: "object"; objectId: string }
  | { kind: "player"; playerId: PlayerId };

export interface ConcedePlayerCommand {
  type: "concede";
}

export interface RespondToPromptPlayerCommand {
  type: "respond-to-prompt";
  promptId: string;
  optionId: string;
  /**
   * Optional optimistic-concurrency check for the prompt state version.
   */
  stateVersion?: number;
}

/**
 * A command submitted by a client. The actor is derived from the
 * authenticated session and is intentionally not part of this type.
 */
export type PlayerCommand =
  | PassPlayerCommand
  | PlayCardPlayerCommand
  | RespondToPromptPlayerCommand
  | ConcedePlayerCommand;

type CommandWithActor<T extends PlayerCommand> = T & {
  playerId: PlayerId;
};

/**
 * A command executed by the engine after the server has attached an
 * authoritative actor to a client command.
 */
export type Command =
  | CommandWithActor<PassPlayerCommand>
  | CommandWithActor<PlayCardPlayerCommand>
  | CommandWithActor<RespondToPromptPlayerCommand>
  | CommandWithActor<ConcedePlayerCommand>;

export type CommandName = Command["type"];
