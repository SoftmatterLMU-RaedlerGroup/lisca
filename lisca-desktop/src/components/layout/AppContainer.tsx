import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { HexBackground } from "@/components/layout/HexBackground";

export function AppContainer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-background p-6 text-foreground md:p-8">
      <HexBackground />
      <div className={cn("relative z-10 mx-auto w-full", className)}>{children}</div>
    </div>
  );
}
