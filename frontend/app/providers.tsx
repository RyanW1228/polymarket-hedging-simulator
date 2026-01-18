// frontend/app/providers.tsx
"use client";

import { WagmiProvider, createConfig, http } from "wagmi";
import { polygon } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

const config = createConfig({
  chains: [polygon],
  transports: {
    [polygon.id]: http(),
  },
  ssr: true,
});

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
