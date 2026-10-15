/** Client presentation contracts. All commands still come from the current server projection. */
export interface DuelCardPopoverAnchor {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}
export type DuelCardSurfaceZone = "hand" | "unit" | "rune" | "gold" | "gear" | "chain";
export interface DuelCardDropTarget {
  readonly kind: "base" | "battlefield";
  readonly locationId: string;
}
export interface DuelCardSurfaceIntent {
  readonly cardUID: string;
  readonly cardId: string | null;
  readonly sourceZone: DuelCardSurfaceZone;
  readonly anchor: DuelCardPopoverAnchor;
  readonly destination?: DuelCardDropTarget;
}
