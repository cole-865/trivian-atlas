"use client";

import { Toaster as SonnerToaster } from "sonner";

function Toaster() {
  return (
    <SonnerToaster
      theme="dark"
      position="top-right"
      toastOptions={{
        className: "border border-border bg-popover text-popover-foreground",
      }}
    />
  );
}

export { Toaster };
