"use client";
import { useId, cloneElement, isValidElement, type ReactElement } from "react";
import {
  type LucideIcon,
  ArrowUpRight,
  ArrowRight,
  Info,
  Plus,
  LoaderCircle,
} from "lucide-react";
import Link from "next/link";
import { Button } from "./ui/button";
export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="page-actions">{children}</div>
    </div>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      <span />
      {children}
    </span>
  );
}
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  href,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: string;
  href?: string;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state ${compact ? "empty-compact" : ""}`}>
      <div className="empty-icon">
        <Icon size={23} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && href && (
        <Button variant="outline" size="sm" asChild>
          <Link href={href}>
            {action}
            <ArrowRight size={14} />
          </Link>
        </Button>
      )}
    </div>
  );
}
export function Panel({
  title,
  description,
  children,
  action,
  className = "",
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Notice({
  children,
  tone = "info",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className={`notice notice-${tone}`}>
      <Info size={16} />
      <div>{children}</div>
    </div>
  );
}
export function Spinner() {
  return <LoaderCircle size={16} className="spinner" />;
}
export function Field({
  label,
  children,
  hint,
  error,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  error?: string;
}) {
  const uid = useId();
  const child = isValidElement(children)
    ? (children as ReactElement<{
        id?: string;
        "aria-describedby"?: string;
        "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling";
      }>)
    : null;
  const id = child?.props.id || uid;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {child
        ? cloneElement(child, {
            id,
            "aria-describedby":
              [
                child.props["aria-describedby"],
                hint && `${uid}-hint`,
                error && `${uid}-error`,
              ]
                .filter(Boolean)
                .join(" ") || undefined,
            "aria-invalid": error ? true : child.props["aria-invalid"],
          })
        : children}
      {hint && <small id={`${uid}-hint`}>{hint}</small>}
      {error && (
        <small className="field-error" id={`${uid}-error`}>
          {error}
        </small>
      )}
    </div>
  );
}
