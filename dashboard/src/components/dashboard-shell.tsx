import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Search01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import type { ComponentProps } from 'react'

export function SearchField({ className, ...props }: Omit<ComponentProps<typeof Input>, 'type'>) {
  return (
    <div className={cn('relative w-full min-w-0 sm:max-w-64', className)}>
      <HugeiconsIcon
        icon={Search01Icon}
        size={14}
        className='pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground'
      />
      <Input type='search' className='h-8 pr-3 pl-9 text-xs shadow-none' {...props} />
    </div>
  )
}
