"use client";

type CompactTab = {
  value: string;
  label: string;
  count?: number;
};

type CompactTabsProps = {
  ariaLabel: string;
  items: CompactTab[];
  value: string;
  onChange: (value: string) => void;
};

export default function CompactTabs({
  ariaLabel,
  items,
  value,
  onChange,
}: CompactTabsProps) {
  return (
    <div className="moovu-compact-tabs" role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const active = item.value === value;

        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={active ? "is-active" : ""}
            onClick={() => onChange(item.value)}
          >
            <span>{item.label}</span>
            {typeof item.count === "number" ? (
              <span className="moovu-compact-tab-count">{item.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
