import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State { return { error } }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Inscrib3 App crashed:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: '24px', color: '#e5e7eb', background: '#000', fontFamily: 'system-ui' }}>
      <div style={{ maxWidth: '480px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '20px', margin: '0 0 8px' }}>Something went wrong</h1>
        <p style={{ color: '#9ca3af', margin: '0 0 16px' }}>{this.state.error.message}</p>
        <button type="button" onClick={() => this.setState({ error: null })} style={{ padding: '10px 16px', border: '1px solid rgba(255,255,255,.2)', borderRadius: '8px', background: '#111', color: '#fff', cursor: 'pointer' }}>Try again</button>
      </div>
    </div>
  }
}
