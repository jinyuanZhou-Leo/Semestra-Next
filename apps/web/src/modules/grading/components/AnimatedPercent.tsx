import { AnimatedNumber } from '@/components/AnimatedNumber'
import { percentText } from '../display'

/** A percentage from the API (0–100) with rolling digits; "—" when there is none. */
export function AnimatedPercent({ value }: { value: number | null | undefined }) {
  if (value == null) return <>—</>
  return <AnimatedNumber value={value} format={percentText} />
}
