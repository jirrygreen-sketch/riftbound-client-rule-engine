import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import type { DuelCardPopoverAnchor } from "./duel-card-interaction";
import "./DuelCardActionPopover.css";

/**
 * Card-adjacent action surface for the live Duel table.
 *
 * Presentation only. It renders whatever server-driven form the caller passes as
 * `children` (the real action / selection controls). It never reads a
 * projection, never derives a rule, and never builds a command of its own: the
 * caller owns "which actions exist", this component only owns "where the box
 * goes and how it is dismissed".
 *
 * Geometry
 *  - `position: fixed` in viewport coordinates, so it stays glued to the card
 *    while the table scrolls; `anchor` is a viewport rect and `anchorElement`
 *    (optional) is re-measured on every resize / scroll / anchor resize.
 *  - Placement is a pure, testable function ({@link computeDuelCardPopoverLayout}):
 *    prefer the card's right side, flip to the left when it would overflow, and
 *    clamp so the box never leaves the viewport. Width is capped at 320px or
 *    `viewport - 16`, whichever is smaller; height is capped and the body
 *    scrolls, so a short window still shows a usable, scrollable menu.
 *
 * Non-modal by construction: no backdrop, no full-screen layer, no scroll lock
 * and no focus trap. Outside pointer-down / Escape dismiss it, and it sits on a
 * stacking layer that never swallows clicks meant for the table.
 *
 * SSR: `createPortal` needs a real DOM node, so the first render (server and the
 * hydration pass) renders the same markup inline and only moves into
 * `document.body` after mount. Geometry is computed in a layout effect, so the
 * un-positioned server markup is `visibility: hidden` rather than misplaced.
 */

const POPOVER_BASE_CLASS = "full-product-card-popover";

export const DUEL_CARD_POPOVER_CLASS = POPOVER_BASE_CLASS;
export const DUEL_CARD_POPOVER_CLOSE_LABEL = "关闭卡牌操作";
export const DUEL_CARD_POPOVER_INSPECT_TEXT = "查看大图";

export const DUEL_CARD_POPOVER_PREFERRED_WIDTH = 320;
export const DUEL_CARD_POPOVER_PREFERRED_MAX_HEIGHT = 420;
export const DUEL_CARD_POPOVER_GAP = 8;
export const DUEL_CARD_POPOVER_MARGIN = 8;

export interface DuelCardActionPopoverProps {
  readonly anchor: DuelCardPopoverAnchor;
  readonly anchorElement?: HTMLElement | null;
  readonly title: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly onInspect?: () => void;
}

export interface DuelCardPopoverViewport {
  readonly width: number;
  readonly height: number;
}

export interface DuelCardPopoverLayoutOptions {
  readonly anchor: DuelCardPopoverAnchor;
  readonly viewport: DuelCardPopoverViewport;
  readonly preferredWidth?: number;
  readonly preferredMaxHeight?: number;
  readonly gap?: number;
  readonly margin?: number;
  /** Actual rendered height keeps short menus close to cards near the bottom. */
  readonly measuredHeight?: number;
}

export interface DuelCardPopoverLayout {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly maxHeight: number;
  /** Side the box ended up on. `left` means it flipped away from the preference. */
  readonly side: "right" | "left";
  readonly flipped: boolean;
}

const finiteOr = (value: number | undefined, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/**
 * Pure placement math. Given a viewport rect and the card's viewport rect,
 * returns the fixed-position box that sits beside the card without leaving the
 * viewport. No DOM access, so it is directly unit-testable.
 */
export function computeDuelCardPopoverLayout(
  options: DuelCardPopoverLayoutOptions
): DuelCardPopoverLayout {
  const margin = Math.max(0, finiteOr(options.margin, DUEL_CARD_POPOVER_MARGIN));
  const gap = Math.max(0, finiteOr(options.gap, DUEL_CARD_POPOVER_GAP));
  const preferredWidth = Math.max(
    0,
    finiteOr(options.preferredWidth, DUEL_CARD_POPOVER_PREFERRED_WIDTH)
  );
  const preferredMaxHeight = Math.max(
    0,
    finiteOr(options.preferredMaxHeight, DUEL_CARD_POPOVER_PREFERRED_MAX_HEIGHT)
  );

  const viewportWidth = Math.max(0, finiteOr(options.viewport.width, 0));
  const viewportHeight = Math.max(0, finiteOr(options.viewport.height, 0));

  const anchorLeft = finiteOr(options.anchor.left, 0);
  const anchorTop = finiteOr(options.anchor.top, 0);
  const anchorWidth = Math.max(0, finiteOr(options.anchor.width, 0));

  // Width/height never exceed the viewport minus both margins ("viewport - 16"
  // at the default margin of 8).
  const availableWidth = Math.max(0, viewportWidth - margin * 2);
  const width = Math.min(preferredWidth, availableWidth);
  const maxHeight = Math.min(preferredMaxHeight, Math.max(0, viewportHeight - margin * 2));

  const spaceRight = viewportWidth - margin - (anchorLeft + anchorWidth);
  const spaceLeft = anchorLeft - margin;
  const rightLeft = anchorLeft + anchorWidth + gap;
  const leftLeft = anchorLeft - gap - width;

  let side: "right" | "left";
  let flipped: boolean;
  let rawLeft: number;
  if (spaceRight >= width) {
    side = "right";
    flipped = false;
    rawLeft = rightLeft;
  } else if (spaceLeft >= width) {
    side = "left";
    flipped = true;
    rawLeft = leftLeft;
  } else if (spaceRight >= spaceLeft) {
    side = "right";
    flipped = false;
    rawLeft = rightLeft;
  } else {
    side = "left";
    flipped = true;
    rawLeft = leftLeft;
  }

  // Clamp inside the viewport. The margin is the preferred inset, but it can
  // never push the box past the hard edge (a viewport narrower than 2 * margin,
  // e.g. a degenerate 0x0 measure, collapses to the top-left corner).
  const maxLeft = Math.max(0, viewportWidth - width);
  const minLeft = Math.min(margin, maxLeft);
  const upperLeft = Math.max(minLeft, viewportWidth - margin - width);
  const left = clampNumber(rawLeft, minLeft, upperLeft);
  const placementHeight = Math.min(maxHeight, Math.max(0, finiteOr(options.measuredHeight, maxHeight)));
  const maxTop = Math.max(0, viewportHeight - placementHeight);
  const minTop = Math.min(margin, maxTop);
  const upperTop = Math.max(minTop, viewportHeight - margin - placementHeight);
  const top = clampNumber(anchorTop, minTop, upperTop);

  return { left, top, width, maxHeight, side, flipped };
}

const hasDom = (): boolean =>
  typeof window !== "undefined" && typeof document !== "undefined" && document.body !== null;

// `useLayoutEffect` warns during server render; fall back to a no-op effect there.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const resolveAnchorRect = (
  anchor: DuelCardPopoverAnchor,
  anchorElement: HTMLElement | null | undefined
): DuelCardPopoverAnchor => {
  if (anchorElement && typeof anchorElement.getBoundingClientRect === "function") {
    const rect = anchorElement.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) {
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }
  }
  return anchor;
};

export function DuelCardActionPopover({
  anchor,
  anchorElement,
  title,
  children,
  onClose,
  onInspect
}: DuelCardActionPopoverProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<DuelCardPopoverLayout | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  // Portal after mount only, so server output and the hydration pass agree.
  useEffect(() => {
    if (!hasDom()) {
      return;
    }
    setPortalTarget(document.body);
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (!hasDom()) {
      return;
    }
    const update = (): void => {
      setLayout(
        computeDuelCardPopoverLayout({
          anchor: resolveAnchorRect(anchor, anchorElement),
          viewport: { width: window.innerWidth, height: window.innerHeight },
          measuredHeight: portalTarget ? containerRef.current?.getBoundingClientRect().height : undefined
        })
      );
    };
    update();

    window.addEventListener("resize", update);
    // Capture phase: reach scrolls inside the table's own scroll containers too.
    window.addEventListener("scroll", update, true);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(update);
      if (anchorElement) observer.observe(anchorElement);
      if (portalTarget && containerRef.current) observer.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      observer?.disconnect();
    };
  }, [anchor.left, anchor.top, anchor.width, anchor.height, anchorElement, portalTarget]);

  // Keyboard reachability: once the menu is in its real body container, move
  // focus into it and hand focus back to the card (or whatever was focused
  // before) on close. No focus trap: Tab can leave the menu at any time.
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!portalTarget) {
      return;
    }
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    containerRef.current?.focus({ preventScroll: true });
    return () => {
      const previous = restoreFocusRef.current;
      if (previous && previous.isConnected) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [portalTarget]);

  // Dismissal: outside pointer-down or Escape. Never preventDefault, so a click
  // on the table still reaches the table after the menu closes.
  useEffect(() => {
    if (!hasDom()) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    const onPointerDown = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (containerRef.current?.contains(target)) {
        return;
      }
      // The anchor toggles itself through the caller; do not double-handle it.
      if (anchorElement && anchorElement.contains(target)) {
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [anchorElement, onClose]);

  // Stay hidden until the box is in `document.body` AND measured, so the inline
  // server/hydration markup and the pre-portal client frame never flash in the
  // wrong place.
  const positioned = portalTarget !== null && layout !== null;
  const positionStyle: CSSProperties = positioned
    ? { left: layout.left, top: layout.top, width: layout.width, maxHeight: layout.maxHeight }
    : { visibility: "hidden" };

  const panel = (
    <div
      ref={containerRef}
      className={POPOVER_BASE_CLASS}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      tabIndex={-1}
      data-positioned={positioned ? "true" : "false"}
      data-side={layout ? layout.side : "right"}
      data-flipped={layout?.flipped ? "true" : "false"}
      style={positionStyle}
    >
      <div className={`${POPOVER_BASE_CLASS}-head`}>
        <h3 className={`${POPOVER_BASE_CLASS}-title`} title={title}>
          {title}
        </h3>
        <button
          type="button"
          className={`${POPOVER_BASE_CLASS}-close`}
          aria-label={DUEL_CARD_POPOVER_CLOSE_LABEL}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className={`${POPOVER_BASE_CLASS}-body`}>{children}</div>
      {onInspect ? (
        <div className={`${POPOVER_BASE_CLASS}-foot`}>
          <button
            type="button"
            className={`${POPOVER_BASE_CLASS}-inspect`}
            onClick={onInspect}
          >
            {DUEL_CARD_POPOVER_INSPECT_TEXT}
          </button>
        </div>
      ) : null}
    </div>
  );

  return portalTarget ? createPortal(panel, portalTarget) : panel;
}
