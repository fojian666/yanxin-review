import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title?: string;
  description: string;
  tall?: boolean;
}

export function EmptyState({ icon, title, description, tall }: EmptyStateProps) {
  return (
    <div className={`empty-state ${tall ? "tall" : ""}`}>
      {icon}
      {title && <h3>{title}</h3>}
      <p>{description}</p>
    </div>
  );
}
