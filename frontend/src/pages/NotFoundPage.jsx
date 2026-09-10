import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <main className="standalone-page">
      <section className="not-found" aria-labelledby="not-found-title">
        <h1 id="not-found-title">Page not found</h1>
        <Link className="button button--primary" to="/">
          Go Home
        </Link>
      </section>
    </main>
  );
}
