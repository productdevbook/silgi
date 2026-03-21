import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  DashboardBrowsingIcon,
  Pulse01Icon,
  RocketIcon,
} from '@hugeicons/core-free-icons'

import { Badge } from '@/components/ui/badge'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from '@/components/ui/sidebar'
import { fmt, fmtUptime } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { Route } from '@/hooks/use-route'
import type { AnalyticsData } from '@/lib/types'

interface AppSidebarProps {
  route: Route
  navigate: (page: string) => void
  data: AnalyticsData | null
  errorCount: number
  requestCount: number
  autoRefresh: boolean
}

export function AppSidebar({
  route,
  navigate,
  data,
  errorCount,
  requestCount,
  autoRefresh,
}: AppSidebarProps) {
  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="gap-0">
        <div className="rounded-xl border bg-sidebar px-3 py-3 group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:py-2">
          <div className="flex items-center justify-between gap-3 group-data-[collapsible=icon]:justify-center">
            <div className="flex items-center gap-2.5 group-data-[collapsible=icon]:gap-0">
              <div className="flex size-8 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-primary">
                <HugeiconsIcon icon={Pulse01Icon} size={16} />
              </div>
              <div className="flex flex-col group-data-[collapsible=icon]:hidden">
                <span className="text-sm font-semibold tracking-tight">silgi</span>
                <span className="text-xs text-sidebar-foreground/70">analytics</span>
              </div>
            </div>
            <Badge variant={autoRefresh ? 'secondary' : 'outline'} className="group-data-[collapsible=icon]:hidden">
              {autoRefresh ? 'Live' : 'Paused'}
            </Badge>
          </div>
          <p className="mt-3 text-xs leading-5 text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden">
            In-memory runtime telemetry for tracing requests, spotting failures, and following span timing.
          </p>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigate</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
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
                    <span className="ml-auto text-[10px] tabular-nums text-muted-foreground group-data-[collapsible=icon]:hidden">
                      {requestCount}
                    </span>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={route.page === 'errors'} onClick={() => navigate('errors')}>
                  <HugeiconsIcon icon={Alert02Icon} size={15} />
                  <span>Errors</span>
                  {errorCount > 0 && (
                    <Badge
                      variant="destructive"
                      className="ml-auto h-4.5 min-w-5 justify-center px-1 text-[10px] group-data-[collapsible=icon]:hidden"
                    >
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
          <SidebarGroupLabel>Runtime</SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="flex flex-col gap-3 rounded-xl border bg-sidebar px-3 py-3 group-data-[collapsible=icon]:hidden">
              <StatusRow label="Uptime" value={data ? fmtUptime(data.uptime) : '–'} />
              <StatusRow label="Req/s" value={data ? fmt(data.requestsPerSecond) : '–'} />
              <StatusRow
                label="Errors"
                value={data ? String(data.totalErrors) : '–'}
                danger={!!data && data.totalErrors > 0}
              />
              <StatusRow label="Procedures" value={data ? String(Object.keys(data.procedures).length) : '–'} />
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="flex flex-col gap-3 rounded-xl border bg-sidebar px-3 py-3 group-data-[collapsible=icon]:hidden">
          <div className="flex items-center justify-between text-xs">
            <span className="text-sidebar-foreground/70">Navigation</span>
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
              Cmd+B
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-xs text-sidebar-foreground/70">
            <span className={cn('size-1.5 rounded-full', autoRefresh ? 'bg-chart-3' : 'bg-muted-foreground/40')} />
            {autoRefresh ? 'Live collector connected' : 'Snapshot mode active'}
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

function StatusRow({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-sidebar-foreground/70">{label}</span>
      <span className={cn('tabular-nums', danger ? 'font-medium text-destructive' : 'text-sidebar-foreground')}>
        {value}
      </span>
    </div>
  )
}
