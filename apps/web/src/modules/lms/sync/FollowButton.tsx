import { CloudDownload } from 'lucide-react'
import { useState } from 'react'
import type { FieldOriginProps, OriginValue } from '@/components/FieldOrigins'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { formatValue } from './labels'
import { useProgramId, useSync } from './status'

/**
 * Beside a field of an imported item whose saved value differs from the LMS's (M09 §4.1): puts
 * the LMS's value into the form, its value in the tooltip. Gone once used.
 */
export function FollowButton({ targetId, field, onApply }: FieldOriginProps) {
  const { status, provider } = useSync(useProgramId())
  const [used, setUsed] = useState(false)
  const differs = status?.different.find((d) => d.target_id === targetId && d.field === field)
  if (!differs || !provider || used) return null
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-xs"
            variant="outline"
            aria-label={m.lms_sync_follow({ provider })}
            onClick={() => {
              onApply(differs.platform as OriginValue)
              setUsed(true)
            }}
          />
        }
      >
        <CloudDownload aria-hidden />
      </TooltipTrigger>
      <TooltipContent>
        {differs.platform === null
          ? m.lms_sync_follow_empty({ provider })
          : m.lms_sync_follow_value({ provider, value: formatValue(field, differs.platform) })}
      </TooltipContent>
    </Tooltip>
  )
}
