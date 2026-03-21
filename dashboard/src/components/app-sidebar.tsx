import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  DashboardBrowsingIcon,
  Moon02Icon,
  RocketIcon,
  Sun03Icon,
} from '@hugeicons/core-free-icons'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from '@/components/ui/sidebar'
import { fmt, fmtUptime } from '@/lib/format'

import type { Route } from '@/hooks/use-route'
import type { AnalyticsData } from '@/lib/types'

interface AppSidebarProps {
  route: Route
  navigate: (page: string) => void
  data: AnalyticsData | null
  errorCount: number
  requestCount: number
  autoRefresh: boolean
  onAutoRefreshChange: (value: boolean) => void
  theme: 'light' | 'dark'
  onThemeToggle: () => void
}

export function AppSidebar({
  route,
  navigate,
  data,
  errorCount,
  requestCount,
  autoRefresh,
  onAutoRefreshChange,
  theme,
  onThemeToggle,
}: AppSidebarProps) {
  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-1">
          <span className="text-sm font-semibold tracking-tight">silgi</span>
          <span className="text-xs text-muted-foreground">analytics</span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={route.page === 'overview'} onClick={() => navigate('overview')}>
                  <HugeiconsIcon icon={DashboardBrowsingIcon} size={15} />
                  <span>Overview</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={route.page === 'requests'} onClick={() => navigate('requests')}>
                  <HugeiconsIcon icon={RocketIcon} size={15} />
                  <span>Requests</span>
                  {requestCount > 0 && (
                    <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">{requestCount}</span>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={route.page === 'errors'} onClick={() => navigate('errors')}>
                  <HugeiconsIcon icon={Alert02Icon} size={15} />
                  <span>Errors</span>
                  {errorCount > 0 && (
                    <Badge variant="destructive" className="ml-auto h-4.5 min-w-5 justify-center px-1 text-[10px]">
                      {errorCount > 99 ? '99+' : errorCount}
                    </Badge>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupContent>
            <div className="space-y-3 px-3 py-1">
              <StatusRow label="Uptime" value={data ? fmtUptime(data.uptime) : '–'} />
              <StatusRow label="Req/s" value={data ? fmt(data.requestsPerSecond) : '–'} />
              <StatusRow label="Errors" value={data ? String(data.totalErrors) : '–'} danger={!!data && data.totalErrors > 0} />
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center gap-1 px-1">
          <button
            onClick={() => onAutoRefreshChange(!autoRefresh)}
            className="flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-muted"
          >
            <span className={`size-1.5 rounded-full ${autoRefresh ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
            <span className="text-muted-foreground">{autoRefresh ? 'Live' : 'Paused'}</span>
          </button>
          <Button variant="ghost" size="icon-xs" onClick={onThemeToggle}>
            <HugeiconsIcon icon={theme === 'dark' ? Sun03Icon : Moon02Icon} size={14} />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

function StatusRow({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${danger ? 'font-medium text-destructive' : 'text-foreground'}`}>{value}</span>
    </div>
  )
}
