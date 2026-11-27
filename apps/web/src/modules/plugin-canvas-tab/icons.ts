import {
  FileText,
  Folder,
  GraduationCap,
  House,
  Layers,
  type LucideIcon,
  Megaphone,
  ScrollText,
} from 'lucide-react'
import type { NativeView } from './navigation'

/** The icon of each of the tab's own views: its menu and the shortcuts card. */
export const NAV_ICONS: Record<NativeView, LucideIcon> = {
  home: House,
  announcements: Megaphone,
  syllabus: ScrollText,
  modules: Layers,
  assignments: GraduationCap,
  pages: FileText,
  files: Folder,
}
