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

  render() {
    if (this.state.hasError) {
      return (
        <main className="standalone-page">
          <ErrorState
            title="MealKhata needs a refresh"
            message="The page could not be displayed safely. Reload to try again."
            actionLabel="Reload page"
            onAction={() => window.location.reload()}
          />
        </main>
      );
    }

    return this.props.children;
  }
}
