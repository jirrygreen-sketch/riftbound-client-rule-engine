import {
  PROTOCOL_V2_COMMAND_CONTRACT,
  type V2Zone
} from "./constants.js";

export type V2PlayerId = string;
export type V2ObjectId = string;

export interface V2CommandBase {
  readonly commandId: string;
  /** Optimistic concurrency token for the authoritative engine state. */
  readonly stateVersion: number;
}

export interface V2ObjectRef {
  readonly objectId: V2ObjectId;
  /** Zone entry identity prevents an old reference being reused after movement. */
  readonly zoneEntryId?: number;
}

export type V2Location =
  | { readonly kind: "base"; readonly playerId: V2PlayerId }
  | { readonly kind: "battlefield"; readonly battlefieldId: string };

export type V2Target =
  | { readonly kind: "object"; readonly objectId: V2ObjectId; readonly zoneEntryId?: number }
  | { readonly kind: "player"; readonly playerId: V2PlayerId }
  | { readonly kind: "battlefield"; readonly battlefieldId: string };

export type V2Pick =
  | { readonly kind: "object"; readonly objectId: V2ObjectId; readonly zoneEntryId?: number }
  | { readonly kind: "player"; readonly playerId: V2PlayerId }
  | { readonly kind: "value"; readonly value: string | number | boolean };

export interface V2PowerPayment {
  readonly domains: readonly string[];
  readonly amount: number;
}

/** A client-selected payment plan. Missing values mean “not selected”; null is never 0. */
export interface V2CostSelection {
  readonly optionId?: string;
  readonly energy?: number;
  readonly power?: readonly V2PowerPayment[];
  readonly xp?: number;
  readonly exhaustObjectIds?: readonly V2ObjectId[];
  readonly recycleObjectIds?: readonly V2ObjectId[];
  readonly hidden?: boolean;
}

export interface V2MulliganCommand extends V2CommandBase {
  readonly type: "mulligan";
  /** `selectedUIDs` is accepted as an engine-facing spelling during migration. */
  readonly selectedObjectIds?: readonly V2ObjectId[];
  readonly selectedUIDs?: readonly V2ObjectId[];
}

export interface V2PlayCommand extends V2CommandBase {
  readonly type: "play";
  readonly cardObjectId: V2ObjectId;
  /** Permanent entry location. Omission preserves the engine's Base default. */
  readonly destination?: V2Location;
  readonly cost?: V2CostSelection;
  readonly targets?: readonly V2Target[];
  readonly picks?: readonly V2Pick[];
}

export interface V2ActivateCommand extends V2CommandBase {
  readonly type: "activate";
  readonly sourceObjectId: V2ObjectId;
  readonly abilityId: string;
  readonly cost?: V2CostSelection;
  readonly targets?: readonly V2Target[];
  readonly picks?: readonly V2Pick[];
}

export interface V2PassCommand extends V2CommandBase {
  readonly type: "pass";
}

export type V2ChoiceAnswer =
  | string
  | number
  | boolean
  | V2ObjectRef
  | readonly (string | number | boolean | V2ObjectRef)[];

export interface V2ChooseCommand extends V2CommandBase {
  readonly type: "choose";
  readonly choiceId: string;
  /** The answer is replayed into the suspended choice request. */
  readonly answer: V2ChoiceAnswer;
}

export interface V2MoveCommand extends V2CommandBase {
  readonly type: "move";
  readonly objectId: V2ObjectId;
  /**
   * Further units that move together with `objectId` as one Standard Move
   * (CR 144 / 810). Omitted for a single-unit move; when present it is
   * non-empty, unique and never repeats `objectId`.
   */
  readonly additionalObjectIds?: readonly V2ObjectId[];
  readonly to: V2MoveDestination;
}

export type V2MoveDestination =
  | { readonly zone: Extract<V2Zone, "base" | "battlefield" | "board" | "hand" | "trash" | "banishment" | "chain">; readonly locationId?: string; readonly playerId?: V2PlayerId }
  | { readonly zone: "deck" | "rune-deck"; readonly position: "top" | "bottom" };

export interface V2DeclareAttackCommand extends V2CommandBase {
  readonly type: "declare-attack";
  readonly battlefieldId: string;
  readonly attackerObjectIds: readonly V2ObjectId[];
}

export interface V2DeclareDefenseCommand extends V2CommandBase {
  readonly type: "declare-defense";
  readonly battlefieldId: string;
  readonly defenderObjectIds: readonly V2ObjectId[];
}

export interface V2ConcedeCommand extends V2CommandBase {
  readonly type: "concede";
}

/** Explicitly ends the authenticated player's Main Phase through TurnFlow. */
export interface V2EndTurnCommand extends V2CommandBase {
  readonly type: "end-turn";
}

/** Continue the current authoritative rules task after a resolved Chain. */
export interface V2AdvanceCommand extends V2CommandBase {
  readonly type: "advance";
}

/** One player's ordered Combat damage allocation for the current Combat. */
export interface V2CombatDamageCommand extends V2CommandBase {
  readonly type: "combat-damage";
  /** The exact Combat whose attacker/defender allocation order is live. */
  readonly combatId: V2ObjectId;
  readonly assignments: readonly {
    readonly unitObjectId: V2ObjectId;
    readonly amount: number;
  }[];
}

/**
 * V2 intent for one rule-granted Basic Rune resource ability.
 *
 * The authenticated session supplies the actor; the client names only the
 * exact Rune incarnation. The server resolves its trusted catalog identity,
 * Domain, and current legality before accepting the command.
 */
export type V2RuneResourceCommand =
  | (V2CommandBase & {
      readonly type: "rune-energy";
      readonly runeObjectId: V2ObjectId;
      readonly zoneEntryId: number;
    })
  | (V2CommandBase & {
      readonly type: "rune-power";
      readonly runeObjectId: V2ObjectId;
      readonly zoneEntryId: number;
    });

export type V2Command =
  | V2MulliganCommand
  | V2PlayCommand
  | V2ActivateCommand
  | V2PassCommand
  | V2ChooseCommand
  | V2MoveCommand
  | V2DeclareAttackCommand
  | V2DeclareDefenseCommand
  | V2ConcedeCommand
  | V2EndTurnCommand
  | V2AdvanceCommand
  | V2CombatDamageCommand
  | V2RuneResourceCommand;

export type V2CommandType = V2Command["type"];
export type V2ClientCommand = V2Command;
export type ProtocolV2Command = V2Command;

export interface V2CommandEnvelope {
  readonly contract: typeof PROTOCOL_V2_COMMAND_CONTRACT;
  readonly command: V2Command;
}

/** Commands written to journal-v1 entries use the command itself as payload. */
export type V2JournalCommand = V2Command;
