import { Component } from 'react';
import { ErrorState } from '../ui/ErrorState.jsx';

export class ErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    if (import.meta.env.DEV) {
      console.error('Application render error', error);
    }
  }

  componentDidUpdate(previousProps) {
    if (this.state.hasError && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="standalone-page">
          <ErrorState
            title={this.props.title || 'MealKhata needs a refresh'}
            message={this.props.message || 'The page could not be displayed safely. Try the page again.'}
            actionLabel="Try again"
            onAction={() => this.setState({ hasError: false })}
          />
        </main>
      );
    }

    return this.props.children;
  }
}
