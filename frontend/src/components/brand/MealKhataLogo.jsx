export function MealKhataLogo({
  variant = 'full',
  size = 28,
  className = '',
  markClassName = '',
  textClassName = '',
}) {
  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 ${markClassName}`}
      aria-hidden="true"
    >
      {/* Outer bowl / plate rim - clean rounded geometry */}
      <path
        d="M5 16C5 22.075 9.925 27 16 27C22.075 27 27 22.075 27 16"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="text-teal-700 dark:text-teal-400"
      />
      {/* Upper plate line */}
      <path
        d="M4 14C4 13.4477 4.44772 13 5 13H27C27.5523 13 28 13.4477 28 14C28 14.5523 27.5523 15 27 15H5C4.44772 15 4 14.5523 4 14Z"
        fill="currentColor"
        className="text-teal-700 dark:text-teal-400"
      />
      {/* Three marks representing 3 roommates sharing meals */}
      <circle cx="9" cy="8" r="2" fill="currentColor" className="text-teal-600 dark:text-teal-300" />
      <circle cx="16" cy="6" r="2" fill="currentColor" className="text-teal-700 dark:text-teal-200" />
      <circle cx="23" cy="8" r="2" fill="currentColor" className="text-teal-600 dark:text-teal-300" />
      {/* Ledger tick / accounting tally mark */}
      <path
        d="M11 20.5L14.5 24L21 17.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-emerald-600 dark:text-emerald-400"
      />
    </svg>
  );

  if (variant === 'mark') {
    return (
      <span className={`inline-flex items-center justify-center ${className}`} aria-label="MealKhata">
        {mark}
      </span>
    );
  }

  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      {mark}
      <div className={`flex flex-col ${textClassName}`}>
        <span className="font-semibold text-base tracking-tight text-slate-900 dark:text-slate-100 leading-tight">
          MealKhata
        </span>
        <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400 leading-none">
          Meals tracked. Bills sorted.
        </span>
      </div>
    </div>
  );
}

export default MealKhataLogo;
