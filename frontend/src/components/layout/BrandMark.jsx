import { Link } from 'react-router-dom';
import { MealKhataLogo } from '../brand/MealKhataLogo.jsx';
import { APP_NAME } from '../../lib/constants.js';

export function BrandMark({ compact = false, className = '' }) {
  return (
    <Link
      to="/"
      aria-label={`${APP_NAME} home`}
      className={`inline-flex items-center gap-2 group transition-opacity hover:opacity-90 ${className}`}
    >
      <MealKhataLogo variant={compact ? 'mark' : 'full'} size={28} />
    </Link>
  );
}
