import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/button.jsx';
import { Card, CardContent } from '../components/ui/card.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

export function NotFoundPage() {
  useDocumentTitle('Page Not Found');

  return (
    <main className="min-h-[60vh] flex items-center justify-center p-4">
      <Card className="max-w-md w-full text-center border-slate-200/90 dark:border-slate-800 shadow-sm p-6 sm:p-8">
        <CardContent className="space-y-4 p-0">
          <span className="text-4xl font-extrabold text-teal-700 dark:text-teal-400">404</span>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            Page not found
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            The page you are looking for doesn&apos;t exist or has moved.
          </p>
          <div className="pt-2">
            <Button variant="default" asChild className="gap-2 text-xs font-semibold">
              <Link to="/">
                <ArrowLeft className="h-4 w-4" />
                <span>Back to Dashboard</span>
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
