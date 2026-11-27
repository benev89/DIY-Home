import { useEffect, useLayoutEffect, useState } from "react";
import { HashRouter, NavLink, Route, Routes, useLocation, useNavigationType } from "react-router-dom";
import { getSetting, seedIfEmpty, setSetting } from "./db";
import { detectLang, I18nProvider, useI18n, type Lang } from "./i18n";
import Home from "./pages/Home";
import AreaPage from "./pages/AreaPage";
import ItemPage from "./pages/ItemPage";
import ItemForm from "./pages/ItemForm";
import ToolsPage from "./pages/ToolsPage";
import FixPage from "./pages/FixPage";
import RepairPage from "./pages/RepairPage";
import HistoryPage from "./pages/HistoryPage";
import SettingsPage from "./pages/SettingsPage";
import CarePage from "./pages/CarePage";

/** New screens open at the top; going back returns to where you were on that screen. */
const scrollPositions = new Map<string, number>();
function ScrollManager() {
  const location = useLocation();
  const navType = useNavigationType();
  useLayoutEffect(() => {
    const key = location.key;
    window.scrollTo(0, navType === "POP" ? (scrollPositions.get(key) ?? 0) : 0);
    // Restore again after content from the database has rendered.
    const late = navType === "POP" ? setTimeout(() => window.scrollTo(0, scrollPositions.get(key) ?? 0), 120) : undefined;
    const save = () => scrollPositions.set(key, window.scrollY);
    window.addEventListener("scroll", save, { passive: true });
    return () => {
      clearTimeout(late);
      window.removeEventListener("scroll", save);
    };
  }, [location.key, navType]);
  return null;
}

function Nav() {
  const { t } = useI18n();
  const links: [string, string, string][] = [
    ["/", "🏠", t.navHome],
    ["/fix", "🔧", t.navFix],
    ["/care", "🗓", t.navCare],
    ["/tools", "🧰", t.navTools],
    ["/history", "📋", t.navHistory],
  ];
  return (
    <nav className="tabbar">
      {links.map(([to, icon, label]) => (
        <NavLink key={to} to={to} end={to === "/"}>
          <span aria-hidden>{icon}</span>
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export default function App() {
  const [lang, setLangState] = useState<Lang | null>(null);

  useEffect(() => {
    (async () => {
      let l = await getSetting<Lang | null>("lang", null);
      if (!l) {
        l = detectLang();
        await setSetting("lang", l);
      }
      await seedIfEmpty(l);
      document.documentElement.lang = l;
      setLangState(l);
    })();
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    void setSetting("lang", l);
    document.documentElement.lang = l;
  };

  if (!lang) return null;
  return (
    <I18nProvider lang={lang} setLang={setLang}>
      <HashRouter>
        <ScrollManager />
        <main className="page">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/area/:id" element={<AreaPage />} />
            <Route path="/item/new" element={<ItemForm />} />
            <Route path="/item/:id" element={<ItemPage />} />
            <Route path="/item/:id/edit" element={<ItemForm />} />
            <Route path="/tools" element={<ToolsPage />} />
            <Route path="/fix" element={<FixPage />} />
            <Route path="/repair/:id" element={<RepairPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/care" element={<CarePage />} />
          </Routes>
        </main>
        <Nav />
      </HashRouter>
    </I18nProvider>
  );
}
