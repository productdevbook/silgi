interface StatCardProps {
  title: string
  value: string
  subtitle?: string
  danger?: boolean
}

export function StatCard({ title, value, subtitle, danger }: StatCardProps) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</div>
      <div className={`text-3xl font-semibold tabular-nums tracking-tight ${danger ? 'text-destructive' : ''}`}>
        {value}
      </div>
      {subtitle && (
        <div className="text-xs text-muted-foreground">{subtitle}</div>
      )}
    </div>
  )
}
