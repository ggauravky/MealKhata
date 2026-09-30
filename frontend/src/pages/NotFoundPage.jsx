import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

export function NotFoundPage() {
  useDocumentTitle('Page Not Found');

  return (
    <main className="standalone-page">
      <section className="not-found" aria-labelledby="not-found-title">
        <h1 id="not-found-title">Page not found</h1>
        <p className="not-found__copy">The page you were looking for doesn&apos;t exist or has moved.</p>
        <Link className="button button--primary" to="/">
          <ArrowLeft size={16} aria-hidden="true" />
          Back to Dashboard
        </Link>
      </section>
    </main>
  );
}
