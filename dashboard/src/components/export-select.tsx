import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Copy01Icon, Tick01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useState } from 'react'

export interface ExportOption {
  id: string
  label: string
  text: string
  hint?: string
}

interface ExportSelectProps {
  copiedId: string | null
  onCopy: (id: string, text: string) => void
  options: ExportOption[]
}

export function ExportSelect({ copiedId, onCopy, options }: ExportSelectProps) {
  const [resetKey, setResetKey] = useState(0)
  const copiedOption = options.find((option) => option.id === copiedId)
  const copied = copiedOption != null

  return (
    <Select
      key={resetKey}
      onValueChange={(value) => {
        const option = options.find((item) => item.id === value)
        if (!option) return
        onCopy(option.id, option.text)
        setResetKey((current) => current + 1)
      }}
    >
      <SelectTrigger size='sm' className='min-w-28'>
        <HugeiconsIcon icon={copied ? Tick01Icon : Copy01Icon} className='size-4 text-muted-foreground' />
        <SelectValue placeholder={copied ? `Copied ${copiedOption.label}` : 'Copy export'} />
      </SelectTrigger>
      <SelectContent align='end'>
        <SelectGroup>
          <SelectLabel>Export</SelectLabel>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              <span className='font-medium'>{option.label}</span>
              {option.hint ? <span className='text-muted-foreground'>{option.hint}</span> : null}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
