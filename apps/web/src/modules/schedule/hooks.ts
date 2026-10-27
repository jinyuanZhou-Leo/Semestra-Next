import { useProgram } from '@/modules/academics/queries'

/** The Program's time zone; calendar times are always shown in it (M04 §2). */
export function useProgramTimezone(programId: string): string | undefined {
  return useProgram(programId).data?.timezone
}
