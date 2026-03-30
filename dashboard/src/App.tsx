import { AppSidebar } from '@/components/app-sidebar'
import { ErrorDetailPage } from '@/components/error-detail-page'
import { Errors } from '@/components/Errors'
import { Overview } from '@/components/Overview'
import { RequestDetailPage } from '@/components/request-detail-page'
import { Requests } from '@/components/requests'
import { SessionDetailPage } from '@/components/session-detail-page'
import { Sessions } from '@/components/sessions'
import { TaskDetailPage } from '@/components/task-detail-page'
import { Tasks } from '@/components/Tasks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { useAnalytics, useKeyboard, useRoute, useTheme } from '@/hooks'
import { cn } from '@/lib/utils'
import { Moon02Icon, Sun03Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

export default function App() {
  const analytics = useAnalytics()
  const { route, navigate } = useRoute()
  const { theme, toggle: toggleTheme } = useTheme()

  useKeyboard({
    navigate,
    toggleRefresh: () => analytics.setAutoRefresh(!analytics.autoRefresh),
  })

  const sessionCount = new Set(analytics.requests.map((r) => r.sessionId).filter(Boolean)).size
  const taskCount = analytics.data?.tasks?.totalRuns ?? 0

  return (
    <SidebarProvider defaultOpen={false}>
      <AppSidebar
        route={route}
        navigate={navigate}
        data={analytics.data}
        errorCount={analytics.errors.length}
        requestCount={analytics.requests.length}
        sessionCount={sessionCount}
        taskCount={taskCount}
      />
      <SidebarInset className='overflow-hidden'>
        <header className='sticky top-0 z-10 flex h-11 items-center justify-between gap-3 border-b bg-background/95 px-3 backdrop-blur md:px-4'>
          <div className='flex min-w-0 items-center gap-3'>
            <SidebarTrigger />
            <Separator orientation='vertical' className='h-4' />
            <span className='text-[11px] font-semibold tracking-[0.3em] text-muted-foreground uppercase'>
              Silgi Analytics
            </span>
          </div>
          <div className='flex items-center gap-1.5'>
            <Button
              variant={analytics.autoRefresh ? 'secondary' : 'outline'}
              size='xs'
              onClick={() => analytics.setAutoRefresh(!analytics.autoRefresh)}
            >
              <span
                data-icon='inline-start'
                className={cn(
                  'size-1.5 rounded-full',
                  analytics.autoRefresh ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                )}
              />
              {analytics.autoRefresh ? 'Live' : 'Paused'}
            </Button>
            {analytics.errors.length > 0 && (
              <Badge variant='destructive' className='text-[10px]'>
                {analytics.errors.length}
              </Badge>
            )}
            <Button variant='ghost' size='icon-sm' onClick={toggleTheme}>
              <HugeiconsIcon icon={theme === 'dark' ? Sun03Icon : Moon02Icon} />
            </Button>
          </div>
        </header>
        <main className='flex-1 overflow-auto'>
          {analytics.error && (
            <div className='border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-900 dark:text-amber-200'>
              {analytics.error}
            </div>
          )}
          {analytics.isLoading && !analytics.data && analytics.requests.length === 0 && analytics.errors.length === 0 && (
            <div className='flex min-h-40 items-center justify-center text-sm text-muted-foreground'>
              Analytics yukleniyor...
            </div>
          )}
          {route.page === 'overview' && <Overview data={analytics.data} navigate={navigate} />}
          {route.page === 'errors' && !route.id && (
            <Errors errors={analytics.errors} navigate={navigate} initialProcedure={route.params.procedure} />
          )}
          {route.page === 'errors' && route.id && (
            <ErrorDetailPage errors={analytics.errors} id={route.id} navigate={navigate} />
          )}
          {route.page === 'requests' && !route.id && (
            <Requests requests={analytics.requests} navigate={navigate} initialProcedure={route.params.procedure} />
          )}
          {route.page === 'requests' && route.id && (
            <RequestDetailPage requests={analytics.requests} id={route.id} navigate={navigate} />
          )}
          {route.page === 'tasks' && !route.id && (
            <Tasks
              data={analytics.data}
              taskExecutions={analytics.taskExecutions}
              scheduledTasks={analytics.scheduledTasks}
              navigate={navigate}
            />
          )}
          {route.page === 'tasks' && route.id && (
            <TaskDetailPage taskExecutions={analytics.taskExecutions} id={route.id} navigate={navigate} />
          )}
          {route.page === 'sessions' && !route.id && <Sessions requests={analytics.requests} navigate={navigate} />}
          {route.page === 'sessions' && route.id && (
            <SessionDetailPage requests={analytics.requests} sessionId={route.id} navigate={navigate} />
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
