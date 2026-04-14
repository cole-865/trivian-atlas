import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

function AppShell({
  sidebar,
  header,
  children,
}: {
  sidebar: ReactNode;
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-transparent text-foreground">
      <div className="flex min-h-screen">
        <div className="hidden xl:block">{sidebar}</div>
        <div className="flex min-w-0 flex-1 flex-col">
          {header}
          <main className="flex-1 px-4 py-5 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}

function AppSidebar({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <aside
      className={cn(
        "h-screen w-72 shrink-0 border-r border-border/80 bg-card/85 backdrop-blur-xl",
        className
      )}
    >
      {children}
    </aside>
  );
}

function AppHeader({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur-xl",
        className
      )}
    >
      {children}
    </header>
  );
}

function AppHeaderInner({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex min-h-[4.5rem] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8",
        className
      )}
    >
      {children}
    </div>
  );
}

export { AppHeader, AppHeaderInner, AppShell, AppSidebar };
