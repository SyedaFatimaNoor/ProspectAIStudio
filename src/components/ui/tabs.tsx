"use client";
import { useId } from "react";

type TabItem = { value: string; label: string };

/**
 * Accessible tab strip with roving focus and arrow-key navigation. Consumers
 * control the selected panel and should label it with `${id}-panel`.
 */
export function Tabs({
  items,
  value,
  onChange,
  className = "tabs",
  label,
}: {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  label: string;
}) {
  const id = useId().replace(/:/g, "");
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.value === value),
  );
  return (
    <div className={className} role="tablist" aria-label={label}>
      {items.map((item, index) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            id={`${id}-tab-${item.value}`}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={selected ? "active" : ""}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : event.key === "ArrowLeft"
                      ? (selectedIndex - 1 + items.length) % items.length
                      : (selectedIndex + 1) % items.length;
              onChange(items[next].value);
              requestAnimationFrame(() =>
                document
                  .getElementById(`${id}-tab-${items[next].value}`)
                  ?.focus(),
              );
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
