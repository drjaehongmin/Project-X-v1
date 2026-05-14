// Tab Bar — labelled "Open Tabs" so it is unambiguous what the row
// represents. Each tab shows the module's title and a close button.
// Active tab is highlighted.

import { useShellStore } from '../store';
import { navigationService } from '../services';

export function TabBar(): JSX.Element {
  const tabs = useShellStore((s) => s.tabs);
  const activeTabId = useShellStore((s) => s.activeTabId);

  return (
    <nav className="tabbar" aria-label="Open tabs">
      <span className="tabbar-label">Open Tabs</span>
      {tabs.length === 0 && (
        <span style={{ alignSelf: 'center', padding: '0 12px', color: '#6b7280', fontSize: 12 }}>
          (no tabs open — choose a module from the left)
        </span>
      )}
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <button
            key={tab.id}
            type="button"
            className={`tab ${isActive ? 'active' : ''}`}
            onClick={() => navigationService.focusTab(tab.id)}
            aria-current={isActive ? 'page' : undefined}
            aria-label={`Tab: ${tab.title}`}
          >
            <span>{tab.title}</span>
            <span
              role="button"
              tabIndex={0}
              className="tab-close"
              aria-label={`Close ${tab.title}`}
              onClick={(e) => {
                e.stopPropagation();
                void navigationService.closeTab(tab.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  e.preventDefault();
                  void navigationService.closeTab(tab.id);
                }
              }}
            >
              ×
            </span>
          </button>
        );
      })}
    </nav>
  );
}
