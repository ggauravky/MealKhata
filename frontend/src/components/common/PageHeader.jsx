export function PageHeader({ title, description, eyebrow, className = '', children }) {
  return (
    <div className={`space-y-1 ${className}`}>
      {eyebrow && (
        <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">
          {eyebrow}
        </span>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100 leading-tight">
          {title}
        </h1>
        {children}
      </div>
      {description && (
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-2xl pt-0.5">
          {description}
        </p>
      )}
    </div>
  );
}
