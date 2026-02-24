import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function AppContainer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="min-h-screen bg-background text-foreground p-6 md:p-8">
      <div className={cn("mx-auto w-full", className)}>{children}</div>
    </div>
  );
}
