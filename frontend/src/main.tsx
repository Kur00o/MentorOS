import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { Toaster } from "sonner";
import { ApiError } from "@/lib/api";
import { AuthProvider } from "@/lib/auth";
import { TipProvider } from "@/ui/overlay";
import App from "./App";
import "./styles/index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && [401, 403, 404, 422].includes(err.status)) && count < 2,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <MotionConfig reducedMotion="user">
            <TipProvider>
              <App />
              <Toaster position="bottom-right" toastOptions={{ className: "!bg-sheet !text-ink !shadow-lift !border-rule/10 !rounded-lg !font-sans" }} />
            </TipProvider>
          </MotionConfig>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
