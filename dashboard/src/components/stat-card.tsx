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
    <Card size='sm' className='bg-muted/15 shadow-none'>
      <CardHeader className='gap-1.5'>
        <CardDescription className='text-[10px] font-medium tracking-[0.24em] uppercase'>{title}</CardDescription>
        <div className={cn('text-2xl font-semibold tabular-nums tracking-tight', danger && 'text-destructive')}>
          {value}
        </div>
      </CardHeader>
      {subtitle && <CardContent className='pt-0 text-[11px] text-muted-foreground'>{subtitle}</CardContent>}
    </Card>
  )
}
