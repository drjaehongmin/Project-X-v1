// The signed-in chrome: top bar, left nav, tab bar + active tab content
// + patient groups bar, audit panel. Layout is CSS Grid; see styles.css.

import { Navigate } from 'react-router-dom';
import { useShellStore } from '../store';
import { TopBar } from './TopBar';
import { LeftNav } from './LeftNav';
import { TabBar } from './TabBar';
import { AuditPanel } from './AuditPanel';
import { PatientGroupBar } from './PatientGroupBar';
import { HomeView } from './HomeView';
import { ModuleHost } from '../modules/ModuleHost';

export function Shell(): JSX.Element {
  const session = useShellStore((s) => s.session);
  const tabs = useShellStore((s) => s.tabs);
  const activeTabId = useShellStore((s) => s.activeTabId);

  if (!session) return <Navigate to="/login" replace />;

  const activeTab =
    activeTabId !== null
      ? tabs.find((t) => t.id === activeTabId) ?? null
      : null;

  return (
    <div className="shell">
      <TopBar />
      <LeftNav />
      <div className="main">
        <TabBar />
        {activeTab ? <ModuleHost tab={activeTab} /> : <HomeView />}
        <PatientGroupBar />
      </div>
      <AuditPanel />
    </div>
  );
}
