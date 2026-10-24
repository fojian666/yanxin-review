import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
  resetKey?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("页面渲染错误", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    const error = this.state.error;
    if (!error) return this.props.children;
    return (
      <div className="error-boundary">
        <AlertTriangle />
        <h3>页面出了点意外</h3>
        <p>{error.message || "渲染时遇到未知错误"}</p>
        <p className="muted">重试或返回问答，皆可继续。</p>
        <div className="error-boundary-actions">
          <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>
            重试
          </button>
          <a className="btn btn-ghost" href="/chat">
            返回问答
          </a>
        </div>
      </div>
    );
  }
}
