import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type PageHeaderProps = {
  kicker: string;
  title: string;
  description?: string;
  actions?: ReactNode;
};

export function PageHeader({ kicker, title, description, actions }: PageHeaderProps) {
  return (
    <section className="moovu-page-header">
      <div className="min-w-0">
        <div className="moovu-section-title">{kicker}</div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="moovu-page-header-actions">{actions}</div> : null}
    </section>
  );
}

type ActionCardProps = {
  title: string;
  description?: string;
  meta?: string;
  action?: ReactNode;
  tone?: "default" | "primary" | "success" | "warning" | "danger";
};

export function ActionCard({ title, description, meta, action, tone = "default" }: ActionCardProps) {
  return (
    <section className={`moovu-action-card moovu-action-card-${tone}`}>
      <div className="min-w-0">
        {meta ? <div className="moovu-action-card-meta">{meta}</div> : null}
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="moovu-action-card-action">{action}</div> : null}
    </section>
  );
}

type ProfileSectionCardProps = {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
};

export function ProfileSectionCard({ title, description, children, action }: ProfileSectionCardProps) {
  return (
    <section className="moovu-profile-section-card">
      <div className="moovu-profile-section-card-header">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {action ? <div>{action}</div> : null}
      </div>
      <div className="moovu-profile-section-card-body">{children}</div>
    </section>
  );
}

type QuickAction = {
  href?: string;
  label: string;
  description?: string;
  onClick?: () => void;
  icon?: LucideIcon;
};

export function QuickActionGrid({ actions }: { actions: QuickAction[] }) {
  return (
    <div className="moovu-quick-action-grid">
      {actions.map((action) => {
        const Icon = action.icon;
        const content = (
          <>
            <span className="moovu-quick-action-mark">
              {Icon ? <Icon aria-hidden="true" /> : null}
            </span>
            <span>
              <strong>{action.label}</strong>
              {action.description ? <small>{action.description}</small> : null}
            </span>
          </>
        );

        if (action.href) {
          return (
            <a key={action.label} href={action.href} className="moovu-quick-action-card">
              {content}
            </a>
          );
        }

        return (
          <button key={action.label} type="button" className="moovu-quick-action-card" onClick={action.onClick}>
            {content}
          </button>
        );
      })}
    </div>
  );
}
