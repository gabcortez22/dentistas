import type { ReactNode } from "react";

export const inputClass =
  "mt-1 min-h-11 w-full rounded-control border border-line bg-surface px-3 text-ink";
export const buttonClass =
  "min-h-11 rounded-control bg-brand px-4 font-medium text-white hover:bg-brand-hover";
export const secondaryButtonClass =
  "min-h-11 rounded-control border border-line bg-surface px-4 font-medium text-ink hover:bg-canvas";

export function Field({
  label,
  name,
  type = "text",
  required = false,
  autoComplete,
  defaultValue,
  minLength,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  defaultValue?: string;
  minLength?: number;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        minLength={minLength}
        className={inputClass}
      />
    </div>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-control border border-danger px-3 py-2 text-danger">
      {children}
    </p>
  );
}

export function Card({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <section className="rounded-card border border-line bg-surface p-4">
      {title ? <h2 className="mb-3 text-xl font-semibold">{title}</h2> : null}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-card border border-dashed border-line p-6 text-ink-muted">{children}</p>
  );
}
