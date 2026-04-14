"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  active?: boolean;
};

function AppSidebarNav({
  accountName,
  accountLabel,
  items,
  mobile = false,
}: {
  accountName: string;
  accountLabel: string;
  items: NavItem[];
  mobile?: boolean;
}) {
  const pathname = usePathname();

  return (
    <div className={cn("flex h-full flex-col", mobile && "min-h-full")}>
      <div className="border-b border-border/70 bg-gradient-to-b from-primary/[0.06] to-transparent px-5 py-5">
        <div className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-primary">
          Trivian Atlas
        </div>
        <div className="mt-4 text-xl font-semibold tracking-tight text-foreground">
          {accountName}
        </div>
        <div className="mt-2 text-[0.68rem] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
          {accountLabel}
        </div>
      </div>

      <nav className="flex-1 space-y-1.5 px-3 py-3.5">
        {items.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/home" && pathname.startsWith(`${item.href}/`));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/[0.08] text-foreground shadow-[inset_0_0_0_1px_rgba(80,220,255,0.12)]"
                  : "text-muted-foreground hover:bg-accent/80 hover:text-accent-foreground"
              )}
            >
              {isActive ? (
                <span className="absolute left-0 top-2.5 bottom-2.5 w-0.5 rounded-r-full bg-primary/90" />
              ) : null}
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function AppMobileNav({
  accountName,
  accountLabel,
  items,
}: {
  accountName: string;
  accountLabel: string;
  items: NavItem[];
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="xl:hidden">
          <Menu />
          <span className="sr-only">Open navigation</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-80 border-r border-border/80 bg-card/98 p-0">
        <AppSidebarNav
          accountName={accountName}
          accountLabel={accountLabel}
          items={items}
          mobile
        />
      </SheetContent>
    </Sheet>
  );
}

export { AppMobileNav, AppSidebarNav };
