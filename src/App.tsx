import { useEffect, useState } from "react";
import { HashRouter, NavLink, Route, Routes } from "react-router-dom";
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

function Nav() {
  const { t } = useI18n();
  const links: [string, string, string][] = [
    ["/", "🏠", t.navHome],
    ["/fix", "🔧", t.navFix],
    ["/tools", "🧰", t.navTools],
    ["/history", "📋", t.navHistory],
    ["/settings", "⚙️", t.navSettings],
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
          </Routes>
        </main>
        <Nav />
      </HashRouter>
    </I18nProvider>
  );
}
