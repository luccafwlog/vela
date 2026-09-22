/* eslint-disable react-refresh/only-export-components */
import { TabButton } from '../ui/TabButton'
import { FICHA_TABS, type FichaTabId } from './fichaTabConfig'
export { FICHA_TABS, resolveFichaTab, type FichaTabId } from './fichaTabConfig'

export function FichaTabBar({ active, onSelect }: { active: FichaTabId; onSelect: (tab: FichaTabId) => void }) {
  return (
    <div className="mb-5 flex flex-wrap gap-2" role="tablist">
      {FICHA_TABS.map((tab) => (
        <TabButton
          key={tab.id}
          active={active === tab.id}
          label={tab.label}
          onClick={() => onSelect(tab.id)}
        />
      ))}
    </div>
  )
}
