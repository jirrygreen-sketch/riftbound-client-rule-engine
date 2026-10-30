import { closeOnBackdropClick } from "../full-product/duel/DuelOverlays";
import {
  MATCH_EXIT_CANCEL,
  MATCH_EXIT_CONFIRM,
  MATCH_EXIT_MESSAGE,
  MATCH_EXIT_TITLE
} from "./match-exit";
import "./AppShell.css";

/** Confirmation shown before leaving a running match; leaving concedes it (RIFT-1161). */
export function MatchExitDialog({ busy, onConfirm, onCancel }: {
  readonly busy: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <div className="rb-exit-backdrop" onClick={busy ? undefined : closeOnBackdropClick(onCancel)}>
      <section className="rb-exit-dialog" role="alertdialog" aria-modal="true" aria-labelledby="rb-exit-title"
        aria-describedby="rb-exit-message">
        <h2 id="rb-exit-title">{MATCH_EXIT_TITLE}</h2>
        <p id="rb-exit-message">{MATCH_EXIT_MESSAGE}</p>
        <div className="rb-exit-actions">
          <button type="button" className="rb-exit-cancel" onClick={onCancel} disabled={busy}>{MATCH_EXIT_CANCEL}</button>
          <button type="button" className="rb-exit-confirm" onClick={onConfirm} disabled={busy}>
            {busy ? "正在认输…" : MATCH_EXIT_CONFIRM}
          </button>
        </div>
      </section>
    </div>
  );
}
