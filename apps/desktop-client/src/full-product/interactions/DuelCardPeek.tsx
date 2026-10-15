import type { DuelCardPopoverAnchor } from "./duel-card-interaction";

/** Display-only hover surface. The caller supplies only currently visible card art. */
export interface DuelCardPeekProps {
  readonly anchor: DuelCardPopoverAnchor;
  readonly anchorElement?: HTMLElement | null;
  readonly title: string;
  readonly imageUrl: string | null;
  readonly cardRole?: "portrait" | "landscape";
}

/** Not connected until the presentation implementation and native checks are complete. */
export function DuelCardPeek(_props: DuelCardPeekProps) { return null; }
