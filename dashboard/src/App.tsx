import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'

import { AppSidebar } from '@/components/app-sidebar'
import { ErrorDetailPage } from '@/components/error-detail-page'
import { Errors } from '@/components/errors'
import { Overview } from '@/components/overview'
import { RequestDetailPage } from '@/components/request-detail-page'
import { Requests } from '@/components/requests'
import { useAnalytics, useRoute, useTheme } from '@/hooks'

export default function App() {
  const analytics = useAnalytics()
  const { route, navigate } = useRoute()
  const { theme, toggle: toggleTheme } = useTheme()

  return (
    <SidebarProvider>
      <AppSidebar
        route={route}
        navigate={navigate}
        data={analytics.data}
        errorCount={analytics.errors.length}
        requestCount={analytics.requests.length}
        autoRefresh={analytics.autoRefresh}
        onAutoRefreshChange={analytics.setAutoRefresh}
        theme={theme}
        onThemeToggle={toggleTheme}
      />
      <SidebarInset>
        <header className="flex h-11 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-3.5" />
          <span className="text-xs text-muted-foreground">silgi analytics</span>
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
