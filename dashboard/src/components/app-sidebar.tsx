import { Badge } from '@/components/ui/badge'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { fmt, fmtMs, fmtUptime } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  Alert02Icon,
  DashboardBrowsingIcon,
  Pulse01Icon,
  RocketIcon,
  UserMultiple02Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import type { Route } from '@/hooks/use-route'
import type { AnalyticsData } from '@/lib/types'

interface AppSidebarProps {
  route: Route
  navigate: (page: string) => void
  data: AnalyticsData | null
  errorCount: number
  requestCount: number
  sessionCount: number
}

export function AppSidebar({ route, navigate, data, errorCount, requestCount, sessionCount }: AppSidebarProps) {
  return (
    <Sidebar collapsible='icon'>
      <SidebarHeader className='gap-0'>
        <div className='flex items-center gap-2 px-1 py-1 group-data-[collapsible=icon]:justify-center'>
          <div className='flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary'>
            <HugeiconsIcon icon={Pulse01Icon} size={16} />
          </div>
          <span className='text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden'>silgi</span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Views</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className='gap-0.5'>
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
                    <span className='ml-auto font-mono text-[10px] tabular-nums text-muted-foreground group-data-[collapsible=icon]:hidden'>
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
                      variant='destructive'
                      className='ml-auto h-4.5 min-w-5 justify-center px-1 text-[10px] group-data-[collapsible=icon]:hidden'
                    >
                      {errorCount > 99 ? '99+' : errorCount}
                    </Badge>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={route.page === 'sessions'} onClick={() => navigate('sessions')}>
                  <HugeiconsIcon icon={UserMultiple02Icon} size={15} />
                  <span>Sessions</span>
                  {sessionCount > 0 && (
                    <span className='ml-auto font-mono text-[10px] tabular-nums text-muted-foreground group-data-[collapsible=icon]:hidden'>
                      {sessionCount}
                    </span>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {data && (
          <SidebarGroup className='mt-auto group-data-[collapsible=icon]:hidden'>
            <SidebarGroupLabel>Node</SidebarGroupLabel>
            <SidebarGroupContent>
              <div className='flex flex-col gap-1.5 px-2 text-[11px]'>
                <NodeRow label='Req/s' value={fmt(data.requestsPerSecond)} />
                <NodeRow label='Avg' value={fmtMs(data.avgLatency)} />
                <NodeRow label='Errors' value={String(data.totalErrors)} danger={data.totalErrors > 0} />
                <NodeRow label='Uptime' value={fmtUptime(data.uptime)} />
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  )
}

function NodeRow({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className='flex items-center justify-between'>
      <span className='text-muted-foreground'>{label}</span>
      <span className={cn('font-mono tabular-nums', danger ? 'font-medium text-destructive' : 'text-foreground')}>
        {value}
      </span>
    </div>
  )
}
