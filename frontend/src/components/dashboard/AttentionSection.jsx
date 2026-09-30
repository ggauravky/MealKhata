import { AlertCircle, AlertTriangle, ArrowRight, CheckCircle2, Info } from 'lucide-react';
import { Link } from 'react-router-dom';

function getAttentionIcon(type) {
  switch (type) {
    case 'financial':
      return AlertCircle;
    case 'settlement':
      return CheckCircle2;
    case 'configuration':
      return AlertTriangle;
    default:
      return Info;
  }
}

export function AttentionSection({ items = [] }) {
  if (!items || items.length === 0) {
    return (
      <div className="attention-empty-banner" role="status">
        <CheckCircle2 size={16} aria-hidden="true" className="attention-empty-icon" />
        <span>You&apos;re all set. No urgent attention required today.</span>
      </div>
    );
  }

  return (
    <section className="attention-section" aria-labelledby="attention-section-title">
      <div className="attention-section__header">
        <span className="section-eyebrow">ATTENTION NEEDED</span>
        <h2 id="attention-section-title" className="sr-only">Attention Items</h2>
      </div>

      <div className="attention-cards-stack">
        {items.map((item) => {
          const Icon = getAttentionIcon(item.type);
          return (
            <div
              key={item.id}
              className={`attention-card attention-card--${item.type}`}
              role="alert"
            >
              <div className="attention-card__icon" aria-hidden="true">
                <Icon size={19} />
              </div>
              <div className="attention-card__body">
                <strong className="attention-card__title">{item.title}</strong>
                <p className="attention-card__message">{item.message}</p>
              </div>
              {item.link && (
                <Link
                  className="button button--compact button--quiet attention-card__action"
                  to={item.link}
                >
                  {item.actionLabel || 'View'}
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
