import { HugeiconsIcon } from '@hugeicons/react'
import {
  ActivityIcon,
  Alert02Icon,
  ChartLineData02Icon,
  Settings01Icon,
} from '@hugeicons/core-free-icons'

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
  SidebarProvider,
  SidebarInset,
} from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

import Errors from './components/Errors'
import Overview from './components/Overview'
import { useAnalytics, fmtUptime } from './hooks'
import { useState } from 'react'

type View = 'overview' | 'errors'

export default function App() {
  const [view, setView] = useState<View>('overview')
  const { data, errors, autoRefresh, setAutoRefresh } = useAnalytics()

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <div className='flex items-center gap-2 px-2 py-1'>
            <HugeiconsIcon icon={ChartLineData02Icon} size={20} className='text-gold' />
            <span className='text-sm font-semibold'>
              <span className='text-gold'>silgi</span> analytics
            </span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Dashboard</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={view === 'overview'} onClick={() => setView('overview')}>
                    <HugeiconsIcon icon={ActivityIcon} size={16} />
                    <span>Overview</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={view === 'errors'} onClick={() => setView('errors')}>
                    <HugeiconsIcon icon={Alert02Icon} size={16} />
                    <span>Errors</span>
                    {errors.length > 0 && (
                      <Badge variant='destructive' className='ml-auto text-[10px] px-1.5 py-0'>
                        {errors.length}
                      </Badge>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>Status</SidebarGroupLabel>
            <SidebarGroupContent>
              <div className='px-3 space-y-2 text-xs text-muted-foreground'>
                <div className='flex justify-between'>
                  <span>Uptime</span>
                  <span className='text-foreground'>{data ? fmtUptime(data.uptime) : '-'}</span>
                </div>
                <div className='flex justify-between'>
                  <span>Requests</span>
                  <span className='text-foreground'>{data ? data.totalRequests.toLocaleString() : '-'}</span>
                </div>
                <div className='flex justify-between'>
                  <span>Errors</span>
                  <span className={data && data.totalErrors > 0 ? 'text-destructive' : 'text-foreground'}>
                    {data ? data.totalErrors : '-'}
                  </span>
                </div>
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <div className='mt-auto p-3'>
          <Separator className='mb-3' />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={autoRefresh ? 'default' : 'outline'}
                size='sm'
                className='w-full'
                onClick={() => setAutoRefresh(!autoRefresh)}
              >
                <HugeiconsIcon icon={Settings01Icon} size={14} />
                {autoRefresh ? 'Live' : 'Paused'}
              </Button>
            </TooltipTrigger>
            <TooltipContent side='right'>
              {autoRefresh ? 'Auto-refreshing every 2s. Click to pause.' : 'Paused. Click to resume.'}
            </TooltipContent>
          </Tooltip>
        </div>
      </Sidebar>

      <SidebarInset>
        {view === 'overview' && <Overview data={data} />}
        {view === 'errors' && <Errors errors={errors} />}
      </SidebarInset>
    </SidebarProvider>
  )
}
