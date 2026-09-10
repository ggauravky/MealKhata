import { CookingPot } from 'lucide-react';
import { Link } from 'react-router-dom';
import { APP_NAME, APP_TAGLINE } from '../../lib/constants.js';

export function BrandMark({ compact = false }) {
  return (
    <Link className="brand" to="/" aria-label={`${APP_NAME} dashboard`}>
      <span className="brand__mark" aria-hidden="true">
        <CookingPot size={20} strokeWidth={1.8} />
      </span>
      <span className="brand__copy">
        <strong>{APP_NAME}</strong>
        {!compact && <small>{APP_TAGLINE}</small>}
      </span>
    </Link>
  );
}
