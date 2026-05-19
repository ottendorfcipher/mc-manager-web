import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: React.ReactNode;
  /** Optional label shown in the error card, e.g. "Chat" or "Admin". */
  label?: string;
}

interface State {
  hasError: boolean;
  message: string;
}

/**
 * Catches uncaught React render errors and shows a recovery screen instead of
 * a blank page.  Wrap the entire app AND individual feature roots for isolation:
 *
 *   <ErrorBoundary>            ← catches whole-app crashes
 *     <ChatPage />             — add label="Chat" for feature-level boundaries
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(err: unknown): State {
    return {
      hasError: true,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  componentDidCatch(err: Error, info: React.ErrorInfo) {
    // In production you could ship this to a logging service.
    console.error("[ErrorBoundary]", err, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, message: "" });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const { label } = this.props;

    return (
      <div
        role="alert"
        aria-live="assertive"
        className="flex flex-col items-center justify-center min-h-[200px] p-8 text-center"
      >
        <div className="card max-w-md w-full space-y-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-[#FEF2F2] dark:bg-[#3B1F1F] mx-auto">
            <AlertTriangle className="w-6 h-6 text-[#F87171]" aria-hidden />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[#1C1E27] dark:text-[#EAECF0]">
              {label ? `${label} crashed` : "Something went wrong"}
            </h2>
            <p className="text-sm text-meta mt-1">
              An unexpected error occurred. Your server data is safe.
            </p>
            {this.state.message && (
              <code className="block mt-2 text-xs font-mono text-meta break-all
                               bg-[#F7F5F2] dark:bg-[#1E2028] rounded px-3 py-2 text-left">
                {this.state.message}
              </code>
            )}
          </div>
          <div className="flex gap-2 justify-center">
            <button onClick={this.handleReset} className="btn-secondary text-sm flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5" aria-hidden /> Try again
            </button>
            <button onClick={() => window.location.reload()} className="btn-primary text-sm">
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
