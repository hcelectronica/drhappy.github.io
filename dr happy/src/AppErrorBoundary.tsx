import { Component, type ErrorInfo, type ReactNode } from 'react'
import { logRuntime } from './runtimeLogger'

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  hasError: boolean
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logRuntime('error', 'react.render.error', { name: error.name, message: error.message, componentStack: info.componentStack })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
          <section style={{ maxWidth: 520, textAlign: 'center' }}>
            <h1>Dr Happy necesita reiniciarse</h1>
            <p>Se registró el error de la aplicación. Recargá la página para continuar.</p>
            <button type="button" onClick={() => window.location.reload()}>Recargar aplicación</button>
          </section>
        </main>
      )
    }
    return this.props.children
  }
}
