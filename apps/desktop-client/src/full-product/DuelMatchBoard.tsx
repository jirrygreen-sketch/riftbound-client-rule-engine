import { DuelMatchBoardSurface } from "./duel/DuelMatchBoardSurface";
import type { DuelMatchBoardProps } from "./duel/duel-board-model";
import "./DuelMatchBoard.css";

export function DuelMatchBoard(props: DuelMatchBoardProps) {
  return <DuelMatchBoardSurface {...props} />;
}

export * from "./duel/duel-board-model";
export * from "./duel/DuelBoardComponents";
export type { DuelWireMatchSetup, DuelWireMatchPlaying } from "@riftbound/protocol";
