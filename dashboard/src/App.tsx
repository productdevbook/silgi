import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

import { AppSidebar } from '@/components/app-sidebar'
import { ErrorDetailPage } from '@/components/error-detail-page'
import { Errors } from '@/components/errors'
import { Overview } from '@/components/overview'
import { RequestDetailPage } from '@/components/request-detail-page'
import { Requests } from '@/components/requests'
import { Moon02Icon, Sun03Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useAnalytics, useRoute, useTheme } from '@/hooks'

export default function App() {
  const analytics = useAnalytics()
  const { route, navigate } = useRoute()
  const { theme, toggle: toggleTheme } = useTheme()
  const pageCopy = getPageCopy(route.page)

  return (
    <SidebarProvider className="bg-muted/30 p-2 md:p-3">
      <AppSidebar
        route={route}
        navigate={navigate}
        data={analytics.data}
        errorCount={analytics.errors.length}
        requestCount={analytics.requests.length}
        autoRefresh={analytics.autoRefresh}
      />
      <SidebarInset className="overflow-hidden rounded-xl border bg-background shadow-sm">
        <header className="sticky top-0 z-10 border-b bg-background">
          <div className="flex flex-col gap-4 px-4 py-4 md:px-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <SidebarTrigger />
                <Separator orientation="vertical" className="h-4" />
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] font-medium tracking-[0.3em] text-muted-foreground uppercase">
                    Silgi Analytics
                  </span>
                  <span className="text-sm font-medium tracking-tight">{pageCopy.kicker}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={analytics.autoRefresh ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => analytics.setAutoRefresh(!analytics.autoRefresh)}
                >
                  <span
                    data-icon="inline-start"
                    className={cn(
                      'size-1.5 rounded-full',
                      analytics.autoRefresh ? 'bg-foreground/80' : 'bg-muted-foreground/40',
                    )}
                  />
                  {analytics.autoRefresh ? 'Live polling' : 'Resume polling'}
                </Button>
                <Badge variant="outline" className="px-2.5">
                  {route.page === 'overview' ? 'Overview' : route.page === 'requests' ? 'Requests' : 'Errors'}
                </Badge>
                <Badge variant="secondary">{analytics.requests.length} traces</Badge>
                <Badge variant={analytics.errors.length > 0 ? 'destructive' : 'secondary'}>
                  {analytics.errors.length} errors
                </Badge>
                <Button variant="ghost" size="icon-sm" onClick={toggleTheme}>
                  <HugeiconsIcon icon={theme === 'dark' ? Sun03Icon : Moon02Icon} />
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{pageCopy.description}</p>
              <Badge variant="outline" className="hidden shrink-0 px-2.5 lg:inline-flex">
                Cmd+B
              </Badge>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-auto">
          {route.page === 'overview' && (
            <Overview data={analytics.data} />
          )}
          {route.page === 'errors' && !route.id && (
            <Errors errors={analytics.errors} navigate={navigate} />
          )}
          {route.page === 'errors' && route.id && (
            <ErrorDetailPage errors={analytics.errors} id={route.id} navigate={navigate} />
          )}
          {route.page === 'requests' && !route.id && (
            <Requests requests={analytics.requests} navigate={navigate} />
          )}
          {route.page === 'requests' && route.id && (
            <RequestDetailPage requests={analytics.requests} id={route.id} navigate={navigate} />
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

function getPageCopy(page: string) {
  switch (page) {
    case 'errors':
      return {
        kicker: 'Failure workspace',
        description: 'Inspect errors with their payload, headers, stack traces, and traced spans in one place.',
      }
    case 'requests':
      return {
        kicker: 'Trace workspace',
        description: 'Follow recent request flows, compare span depth, and open individual traces without losing context.',
      }
    default:
      return {
        kicker: 'Command center',
        description: 'A shadcn-first analytics shell for monitoring throughput, latency, and failures across the current instance.',
      }
  }
}
