import { AlertTriangle } from "lucide-react";

// Shared error-state UI for the criticalLoadErrors pattern in main.tsx:
// a failed critical loader (inventory movements, project documents, ...)
// renders this in place of its normal content instead of looking like a
// real empty state. See the criticalLoadErrors comment in main.tsx for
// the full pattern.
export function DataLoadErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="data-load-error-banner" role="alert">
      <AlertTriangle size={16} />
      <span>{message}</span>
      {onRetry && (
        <button className="secondary-action mini-action" type="button" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
