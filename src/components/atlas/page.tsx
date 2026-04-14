import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <Card className="border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
      <CardHeader className="gap-3 pb-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            {eyebrow ? (
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-primary">
                {eyebrow}
              </div>
            ) : null}
            <CardTitle className="mt-1.5 text-xl">{title}</CardTitle>
            {description ? (
              <CardDescription className="mt-1 text-sm text-muted-foreground/80">
                {description}
              </CardDescription>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </CardHeader>
    </Card>
  );
}

function SectionCard({
  eyebrow,
  title,
  description,
  children,
  actions,
  contentClassName,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
  contentClassName?: string;
}) {
  return (
    <Card className="border-border/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] shadow-[0_16px_36px_rgba(0,0,0,0.2)]">
      <CardHeader className="gap-3 pb-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            {eyebrow ? (
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-primary">
                {eyebrow}
              </div>
            ) : null}
            <CardTitle className="mt-1.5 text-lg">{title}</CardTitle>
            {description ? (
              <CardDescription className="mt-1 text-sm text-muted-foreground/80">
                {description}
              </CardDescription>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </CardHeader>
      <CardContent className={cn("pt-0", contentClassName)}>{children}</CardContent>
    </Card>
  );
}

function NoticeBanner({
  tone,
  children,
}: {
  tone: "notice" | "error";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3 text-sm",
        tone === "error"
          ? "border-destructive/35 bg-destructive/10 text-destructive"
          : "border-success/35 bg-success/10 text-success"
      )}
    >
      {children}
    </div>
  );
}

function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-background/25 px-6 py-10 text-center",
        className
      )}
    >
      <div className="text-base font-semibold text-foreground">{title}</div>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground/82">{description}</p>
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-3">{action}</div> : null}
    </div>
  );
}

export { EmptyState, NoticeBanner, PageHeader, SectionCard };
