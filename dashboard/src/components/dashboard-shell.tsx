import type { ComponentProps, ReactNode } from 'react'
import { ArrowLeft01Icon, Search01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-6 px-5 py-5 md:px-6 md:py-6 lg:px-8', className)}>
      {children}
    </div>
  )
}

interface PageHeroProps {
  eyebrow?: string
  title: string
  description: string
  badges?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
}

export function PageHero({
  eyebrow,
  title,
  description,
  badges,
  actions,
  children,
  className,
}: PageHeroProps) {
  return (
    <Card className={cn('overflow-hidden shadow-sm', className)}>
      <CardHeader className="gap-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {eyebrow && (
              <p className="text-[11px] font-medium tracking-[0.24em] text-muted-foreground uppercase">
                {eyebrow}
              </p>
            )}
            <div className="flex flex-col gap-2">
              <CardTitle className="text-2xl tracking-tight sm:text-3xl">{title}</CardTitle>
              <CardDescription className="max-w-2xl text-sm leading-6">{description}</CardDescription>
            </div>
            {badges && <div className="flex flex-wrap gap-2">{badges}</div>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </div>
      </CardHeader>
      {children && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  )
}

interface SectionCardProps {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}

export function SectionCard({
  title,
  subtitle,
  action,
  children,
  className,
  contentClassName,
}: SectionCardProps) {
  return (
    <Card className={cn('shadow-sm', className)}>
      <CardHeader className="gap-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <CardTitle className="text-base tracking-tight">{title}</CardTitle>
            {subtitle && <CardDescription className="text-sm leading-6">{subtitle}</CardDescription>}
          </div>
          {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
        </div>
      </CardHeader>
      <CardContent className={cn('pt-0', contentClassName)}>{children}</CardContent>
    </Card>
  )
}

export function SearchField({
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, 'type'>) {
  return (
    <div className={cn('relative w-full min-w-0 sm:max-w-80', className)}>
      <HugeiconsIcon
        icon={Search01Icon}
        size={14}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        className="h-9 pr-3 pl-9 text-sm shadow-none"
        {...props}
      />
    </div>
  )
}

interface EmptyStateProps {
  title: string
  description: string
  action?: ReactNode
  className?: string
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <Card className={cn('border-dashed shadow-none', className)}>
      <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium tracking-tight">{title}</p>
          <p className="max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        {action}
      </CardContent>
    </Card>
  )
}

export function BackButton({ children, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button variant="ghost" size="xs" {...props}>
      <HugeiconsIcon icon={ArrowLeft01Icon} data-icon="inline-start" />
      {children}
    </Button>
  )
}

interface InsightPillProps {
  label: string
  value: string
  meta?: string
}

export function InsightPill({ label, value, meta }: InsightPillProps) {
  return (
    <Card size="sm" className="bg-muted/30 shadow-none">
      <CardContent className="flex flex-col gap-1">
        <span className="text-[11px] font-medium tracking-[0.24em] text-muted-foreground uppercase">{label}</span>
        <span className="truncate text-sm font-medium tracking-tight">{value}</span>
        {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
      </CardContent>
    </Card>
  )
}

export function CodePanel({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed">
      {children}
    </pre>
  )
}
