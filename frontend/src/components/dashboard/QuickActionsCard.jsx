import {
  Bell,
  CalendarDays,
  ChartNoAxesCombined,
  Coins,
  CreditCard,
  FileCheck,
  UtensilsCrossed,
} from 'lucide-react';
import { Link } from 'react-router-dom';

const iconMap = {
  CalendarDays,
  ChartNoAxesCombined,
  CreditCard,
  UtensilsCrossed,
  Coins,
  FileCheck,
  Bell,
};

export function QuickActionsCard({ actions = [] }) {
  if (!actions || actions.length === 0) return null;

  return (
    <section className="panel quick-actions-panel" aria-labelledby="quick-actions-title">
      <div className="quick-actions-panel__header">
        <span className="section-eyebrow">QUICK ACTIONS</span>
        <h2 id="quick-actions-title">Shortcuts</h2>
      </div>

      <div className="quick-actions-grid">
        {actions.map((action) => {
          const Icon = iconMap[action.icon] || ChartNoAxesCombined;
          return (
            <Link key={action.id} className="quick-action-button" to={action.to}>
              <span className="quick-action-button__icon" aria-hidden="true">
                <Icon size={20} strokeWidth={1.8} />
              </span>
              <span className="quick-action-button__label">{action.label}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
