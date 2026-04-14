import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { PageStep1 } from "./components/PageStep1";
import { PageStep2 } from "./components/PageStep2";
import { PageStep3 } from "./components/PageStep3";
import { PageConfig } from "./components/PageConfig";
import { PageHist } from "./components/PageHist";
import { PageSeq } from "./components/PageSeq";
import { PageRules } from "./components/PageRules";
import { useApp } from "./context/AppContext";

const SB_COLLAPSE_KEY = "ntx_sidebar_collapsed";

function loadSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SB_COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function App() {
  const { curPage } = useApp();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(SB_COLLAPSE_KEY, sidebarCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((c) => !c);
  }, []);

  return (
    <div className="app">
      <Sidebar collapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar} />
      <main className={`main${sidebarCollapsed ? " main--sb-collapsed" : ""}`}>
        {curPage === "step1" && <PageStep1 />}
        {curPage === "step2" && <PageStep2 />}
        {curPage === "step3" && <PageStep3 />}
        {curPage === "config" && <PageConfig />}
        {curPage === "hist" && <PageHist />}
        {curPage === "seq" && <PageSeq />}
        {curPage === "rules" && <PageRules />}
      </main>
    </div>
  );
}

export default App;
