import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface StatCardProps {
  title: string
  value: string
  subtitle?: string
  danger?: boolean
}

export function StatCard({ title, value, subtitle, danger }: StatCardProps) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="gap-3">
        <CardDescription className="text-[11px] font-medium tracking-[0.24em] uppercase">{title}</CardDescription>
        <div className={cn('text-3xl font-semibold tabular-nums tracking-tight', danger && 'text-destructive')}>
          {value}
        </div>
      </CardHeader>
      {subtitle && (
        <CardContent className="pt-0 text-xs text-muted-foreground">{subtitle}</CardContent>
      )}
    </Card>
  )
}
