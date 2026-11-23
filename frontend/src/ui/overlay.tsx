import type { ReactNode } from "react";
import * as D from "@radix-ui/react-dialog";
import * as T from "@radix-ui/react-tooltip";
import * as Pop from "@radix-ui/react-popover";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/format";
import { EASE } from "./core";

export function Dialog({ open, onOpenChange, title, description, children, footer, width = 560 }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <D.Portal forceMount>
            <D.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-50 bg-ink/30 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} />
            </D.Overlay>
            <D.Content asChild forceMount aria-describedby={description ? undefined : undefined}>
              <motion.div
                className="fixed left-1/2 top-[8vh] z-50 flex max-h-[84vh] w-[calc(100vw-24px)] -translate-x-1/2 flex-col overflow-hidden rounded-xl bg-sheet shadow-lift hairline focus:outline-none"
                style={{ maxWidth: width }}
                initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.99 }} transition={{ duration: 0.45, ease: EASE }}
              >
                <div className="flex items-start justify-between gap-4 border-b border-rule/10 px-6 py-5">
                  <div>
                    <D.Title className="font-display text-[1.45rem] leading-tight tracking-[-0.02em]">{title}</D.Title>
                    {description ? <D.Description className="mt-1 text-sm text-graphite">{description}</D.Description> : <D.Description className="sr-only">Dialog</D.Description>}
                  </div>
                  <D.Close className="-mr-2 grid h-8 w-8 place-items-center rounded-md text-graphite hover:bg-ink/5 hover:text-ink" aria-label="Close"><X size={18} /></D.Close>
                </div>
                <div className="overflow-y-auto px-6 py-5">{children}</div>
                {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-rule/10 bg-paper-deep/40 px-6 py-4">{footer}</div>}
              </motion.div>
            </D.Content>
          </D.Portal>
        )}
      </AnimatePresence>
    </D.Root>
  );
}

export function Drawer({ open, onOpenChange, title, children, width = 520, label }: { open: boolean; onOpenChange: (v: boolean) => void; title: ReactNode; children: ReactNode; width?: number; label?: ReactNode }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <D.Portal forceMount>
            <D.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-50 bg-ink/25" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </D.Overlay>
            <D.Content asChild forceMount>
              <motion.aside className="fixed bottom-0 right-0 top-0 z-50 flex w-full flex-col bg-sheet shadow-lift focus:outline-none" style={{ maxWidth: width }}
                initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ duration: 0.55, ease: EASE }}>
                <div className="flex items-center justify-between border-b border-rule/10 px-6 py-4">
                  <div>{label && <div className="readout">{label}</div>}<D.Title className="font-display text-xl">{title}</D.Title><D.Description className="sr-only">Panel</D.Description></div>
                  <D.Close className="grid h-8 w-8 place-items-center rounded-md text-graphite hover:bg-ink/5" aria-label="Close"><X size={18} /></D.Close>
                </div>
                <div className="flex-1 overflow-y-auto">{children}</div>
              </motion.aside>
            </D.Content>
          </D.Portal>
        )}
      </AnimatePresence>
    </D.Root>
  );
}

export function Tip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <T.Root delayDuration={200}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="z-[70] max-w-xs rounded-md bg-ink px-2.5 py-1.5 text-xs text-paper shadow-lift data-[state=delayed-open]:animate-in">
          {content}
          <T.Arrow className="fill-ink" />
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
export const TipProvider = T.Provider;

export function Popover({ trigger, children, align = "end", className }: { trigger: ReactNode; children: ReactNode; align?: "start" | "center" | "end"; className?: string }) {
  return (
    <Pop.Root>
      <Pop.Trigger asChild>{trigger}</Pop.Trigger>
      <Pop.Portal>
        <Pop.Content align={align} sideOffset={8} className={cn("z-[60] rounded-lg bg-sheet shadow-lift hairline focus:outline-none", className)}>
          {children}
        </Pop.Content>
      </Pop.Portal>
    </Pop.Root>
  );
}

export function DropMenu({ trigger, items, align = "end" }: { trigger: ReactNode; items: ({ label: ReactNode; onSelect: () => void; icon?: ReactNode; danger?: boolean } | "sep")[]; align?: "start" | "end" }) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>{trigger}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align={align} sideOffset={6} className="z-[60] min-w-[200px] rounded-lg bg-sheet p-1 shadow-lift hairline">
          {items.map((it, i) =>
            it === "sep" ? <Menu.Separator key={i} className="my-1 h-px bg-rule/10" /> : (
              <Menu.Item key={i} onSelect={it.onSelect}
                className={cn("flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-ink/[0.05]", it.danger && "text-critical")}>
                {it.icon}{it.label}
              </Menu.Item>
            ),
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
