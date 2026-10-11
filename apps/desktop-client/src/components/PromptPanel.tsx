import { CircleHelp } from "lucide-react";
import type { Prompt } from "@riftbound/protocol";

interface PromptPanelProps {
  prompt: Prompt | null;
  viewerPlayerId: string | null;
  pendingOptionId: string | null;
  disabled?: boolean;
  onRespond: (promptId: string, optionId: string, stateVersion?: number) => void;
}

export function PromptPanel({
  prompt,
  viewerPlayerId,
  pendingOptionId,
  disabled = false,
  onRespond
}: PromptPanelProps) {
  const visiblePrompt =
    prompt && prompt.playerId === viewerPlayerId ? prompt : null;

  return (
    <section className="prompt-panel" aria-label="当前 Prompt">
      <div className="panel-title">
        <CircleHelp size={16} aria-hidden />
        <h2>当前 Prompt</h2>
      </div>
      {!visiblePrompt ? (
        <p className="empty-zone">没有等待你决策的 Prompt</p>
      ) : (
        <article className="prompt-card prompt-pending">
          <header>
            <h3>{promptTitle(visiblePrompt.reason)}</h3>
            <span>等待选择</span>
          </header>
          <p>{visiblePrompt.optional ? "可选触发效果" : "必须处理的效果"}</p>
          <div className="chip-row">
            {visiblePrompt.options.map(option => (
              <button
                key={option.id}
                type="button"
                className={`chip ${pendingOptionId === option.id ? "selected" : ""}`}
                onClick={() =>
                  onRespond(visiblePrompt.id, option.id, visiblePrompt.stateVersion)
                }
                disabled={disabled || pendingOptionId !== null}
              >
                {optionLabel(option.id, option.label)}
              </button>
            ))}
          </div>
        </article>
      )}
    </section>
  );
}

function promptTitle(reason: string): string {
  if (reason === "trigger-conquer") return "Trigger Conquer";
  return reason || "等待响应";
}

function optionLabel(optionId: string, fallback: string): string {
  if (optionId === "resolve") return "结算触发";
  if (optionId === "skip") return "跳过触发";
  return fallback;
}
