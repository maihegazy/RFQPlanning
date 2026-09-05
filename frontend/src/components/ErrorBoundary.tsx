import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './ui'

interface State {
  error: Error | null
}

/**
 * Keeps a render error on one page from blanking the whole portal. The
 * sidebar and header stay usable; the page shows what went wrong and a way to
 * reload it. Mounted with `key={pathname}` so navigating away resets it.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page failed to render', error, info.componentStack)
  }

  render() {
    if (this.state.error === null) return this.props.children
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div
          role="alert"
          className="rounded-xl border border-rose-800 bg-rose-950/50 px-5 py-4 text-sm text-rose-200"
        >
          <p className="text-base font-semibold text-rose-100">This page hit an error</p>
          <p className="mt-1">
            Something in this view failed to render. Your saved data is not affected; unsaved edits
            on this page may be lost.
          </p>
          <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-slate-950/60 p-3 text-xs text-rose-200/80">
            {this.state.error.message}
          </pre>
          <div className="mt-4 flex gap-2">
            <Button onClick={() => window.location.reload()}>Reload the page</Button>
            <Button variant="secondary" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
