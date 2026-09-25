import { useEffect, useState } from "react";

import ChatScreen from "./components/ChatScreen.js";
import MarketMarquee from "./components/MarketMarquee.js";
import PortfolioScreen from "./components/PortfolioScreen.js";

type Screen = "chat" | "portfolio";

const SCREENS: { id: Screen; label: string; hash: string }[] = [
  { id: "chat", label: "Chat", hash: "#/" },
  { id: "portfolio", label: "Portfolio", hash: "#/portfolio" },
];

const screenFromHash = (): Screen => (window.location.hash.startsWith("#/portfolio") ? "portfolio" : "chat");

/**
 * Ticker across the top, then Chat (conversations · chat · market data) or Portfolio.
 * Screens are hash routes so they survive reloads and work with back/forward.
 * Replace the hardcoded userId once you add authentication.
 */
export default function App() {
  const userId = "u1";
  const [screen, setScreen] = useState<Screen>(screenFromHash);

  useEffect(() => {
    const onHashChange = () => setScreen(screenFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return (
    <div className="app-shell">
      <MarketMarquee />

      <header className="app-header">
        <div>
          <h1>Finance Assistant</h1>
          <p>Educational information about markets, portfolios, goals and tax. Not financial advice.</p>
        </div>
        <nav className="app-nav" aria-label="Screens">
          {SCREENS.map((item) => (
            <a key={item.id} href={item.hash} aria-current={screen === item.id ? "page" : undefined}>
              {item.label}
            </a>
          ))}
        </nav>
      </header>

      {screen === "portfolio" ? <PortfolioScreen /> : <ChatScreen userId={userId} />}
    </div>
  );
}
