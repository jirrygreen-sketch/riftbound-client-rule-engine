import type { PlayerCommand } from "@riftbound/protocol";
import { buildSubmissionFromSelection, deriveLegalActions, targetOptionsFor } from "./commands";
import type {
  ActionSelection,
  PlayableMatchView,
  SubmissionContext
} from "./types";

export interface PromptActionPanelProps {
  readonly view: PlayableMatchView;
  readonly selection: ActionSelection;
  readonly onSelectionChange: (selection: ActionSelection) => void;
  readonly onSubmit: (command: PlayerCommand, context: SubmissionContext) => void;
}

export function PromptActionPanel({
  view,
  selection,
  onSelectionChange,
  onSubmit
}: PromptActionPanelProps) {
  const actions = deriveLegalActions(view);
  const selectedAction =
    actions.find(action => action.id === selection.actionId) ?? null;
  const targetOptions = targetOptionsFor(view, selection);
  const canSubmit =
    selectedAction !== null &&
    buildSubmissionFromSelection(selection, view) !== null;
  const readOnly =
    view.connectionStatus !== "connected" || view.commandPending;

  return (
    <section className="full-product-actions" aria-label="合法动作与选择">
      <h2>当前动作</h2>
      <ul>
        {actions.map(action => (
          <li key={action.id}>
            <button
              type="button"
              disabled={readOnly || action.disabled}
              aria-pressed={selection.actionId === action.id}
              onClick={() =>
                onSelectionChange({
                  actionId: action.id,
                  cardId: action.selectedCardId ?? null,
                  targetIds: []
                })
              }
            >
              {action.label}
            </button>
            {action.reason ? <span>{action.reason}</span> : null}
          </li>
        ))}
      </ul>

      {selectedAction?.requiresTargets ? (
        <div>
          <h3>选择目标</h3>
          {targetOptions.length === 0 ? (
            <p>等待可用目标</p>
          ) : (
            targetOptions.map(target => (
              <button
                key={target.id}
                type="button"
                disabled={readOnly || (target as { readonly disabled?: boolean }).disabled === true}
                aria-pressed={selection.targetIds.includes(target.id)}
                onClick={() =>
                  onSelectionChange({
                    ...selection,
                    targetIds: selection.targetIds.includes(target.id)
                      ? selection.targetIds.filter(id => id !== target.id)
                      : [...selection.targetIds, target.id]
                  })
                }
              >
                {target.label}
              </button>
            ))
          )}
        </div>
      ) : null}

      <button
        type="button"
        disabled={readOnly || !canSubmit}
        onClick={() => {
          const command = buildSubmissionFromSelection(selection, view);
          if (command === null) return;
          onSubmit(command, {
            actionType: selectedAction?.type ?? null,
            cardId: selection.cardId,
            targetIds: selection.targetIds,
            projection: view.projection
          });
        }}
      >
        提交
      </button>
      {readOnly ? <p>当前棋盘只读</p> : null}
    </section>
  );
}
