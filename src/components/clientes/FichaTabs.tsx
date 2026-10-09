/* eslint-disable react-refresh/only-export-components */
import { TabButton } from '../ui/TabButton'
import { TabList } from '../ui/TabList'
import { availableFichaTabs, type FichaTabId } from './fichaTabConfig'
export { FICHA_TABS, availableFichaTabs, resolveFichaTab, type FichaTabId } from './fichaTabConfig'

export function fichaTabId(tab: FichaTabId) { return `cliente-tab-${tab}` }
export function fichaPanelId(tab: FichaTabId) { return `cliente-panel-${tab}` }

export function FichaTabBar({
  active,
  onSelect,
  canReadCeUnlock = true,
  counts = {},
}: {
  active: FichaTabId
  onSelect: (tab: FichaTabId) => void
  canReadCeUnlock?: boolean
  counts?: Partial<Record<FichaTabId, { value: number; label: string }>>
}) {
  return (
    <TabList label="Seções da ficha do Cliente" className="app-customer-tabs">
      {availableFichaTabs(canReadCeUnlock).map((tab) => (
        <TabButton
          key={tab.id}
          id={fichaTabId(tab.id)}
          controls={active === tab.id ? fichaPanelId(tab.id) : undefined}
          active={active === tab.id}
          label={tab.label}
          count={counts[tab.id]?.value}
          countLabel={counts[tab.id]?.label}
          onClick={() => onSelect(tab.id)}
        />
      ))}
    </TabList>
  )
}
