import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

export function CompanionButton() {
  const companionOpen = useAppStore((s) => s.companionOpen);
  const setCompanionOpen = useAppStore((s) => s.setCompanionOpen);

  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
      onClick={() => setCompanionOpen(!companionOpen)}
      aria-label="Open AI Companion"
      className={cn(
        "fixed bottom-4 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-azure-500 text-white shadow-lg transition-colors hover:bg-azure-600 focus:outline-none focus:ring-2 focus:ring-azure-200 sm:bottom-5 sm:right-5",
        companionOpen ? "hidden" : "flex animate-pulse"
      )}
    >
      <Sparkles size={24} />
    </motion.button>
  );
}
