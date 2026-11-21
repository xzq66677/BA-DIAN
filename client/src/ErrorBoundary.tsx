/**
 * 全局错误边界。
 *
 * 渲染期一旦有异常（例如某处读到了 undefined 的字段），React 会卸载整棵树——
 * 表现就是「所有面板突然全部消失」的白屏。这里把异常兜住，展示可读的错误信息 +
 * 重新载入按钮；对局状态在服务端，刷新后按 localStorage 令牌自动重连。
 *
 * 注意：错误边界只处理**渲染/生命周期**异常，不处理事件回调与异步 Promise；
 * 事件回调里的失败应在调用处 try/catch 并转化为界面提示。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 保留完整堆栈，便于定位；错误边界只负责不让界面变白
    console.error('[拔典] 界面渲染异常', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="tcg-app" style={{ padding: 24 }}>
        <div className="tcg-panel" style={{ maxWidth: 680, margin: '48px auto', textAlign: 'center' }}>
          <h2 style={{ marginBottom: 8 }}>🎴 界面遇到了一个错误</h2>
          <p style={{ color: 'var(--gold-2)', wordBreak: 'break-all' }}>{String(error.message || error)}</p>
          <p style={{ opacity: 0.78, lineHeight: 1.7 }}>
            对局状态保存在服务端，刷新页面即可回到对局（本设备身份会自动重连）。
            若反复出现，请把控制台里「界面渲染异常」那条日志发给开发者。
          </p>
          <button className="tcg-btn" style={{ marginTop: 12 }} onClick={() => window.location.reload()}>
            重新载入
          </button>
        </div>
      </div>
    );
  }
}
