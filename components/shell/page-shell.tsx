import type { ReactNode } from "react";
import { SidebarNav } from "./nav";

function Sidebar() {
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r bg-card md:flex">
      <div className="flex h-14 items-center gap-2 border-b px-5">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
          OC
        </span>
        <span className="text-sm font-semibold tracking-tight">Op-Code Identifier</span>
      </div>
      <SidebarNav />
      <div className="border-t p-4 text-xs text-muted-foreground">
        <span className="font-semibold text-accent">EZ Wins</span> internal tool
      </div>
    </aside>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center border-b bg-card/80 px-6 backdrop-blur lg:px-8">
          <h1 className="text-sm font-semibold leading-none tracking-tight">Op-Code Identifier</h1>
        </header>
        <main className="flex-1 px-6 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
