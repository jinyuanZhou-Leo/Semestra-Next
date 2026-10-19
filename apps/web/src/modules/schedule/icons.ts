import {
  BookOpen,
  ClipboardCheck,
  FlaskConical,
  GraduationCap,
  type LucideIcon,
  MapPin,
  Mic,
  Monitor,
  PenLine,
  Presentation,
  Users,
} from 'lucide-react'
import { m } from '@/paraglide/messages'

/** Icons an event type can use, by lucide name (stored as the name, M04 §2). */
export const TYPE_ICONS: Readonly<Record<string, LucideIcon>> = {
  presentation: Presentation,
  'flask-conical': FlaskConical,
  users: Users,
  'book-open': BookOpen,
  'clipboard-check': ClipboardCheck,
  'pen-line': PenLine,
  'graduation-cap': GraduationCap,
  mic: Mic,
  monitor: Monitor,
  'map-pin': MapPin,
}

/** What each icon shows, for the icon picker. */
export const TYPE_ICON_LABELS: Readonly<Record<string, () => string>> = {
  presentation: m.schedule_icon_presentation,
  'flask-conical': m.schedule_icon_flask_conical,
  users: m.schedule_icon_users,
  'book-open': m.schedule_icon_book_open,
  'clipboard-check': m.schedule_icon_clipboard_check,
  'pen-line': m.schedule_icon_pen_line,
  'graduation-cap': m.schedule_icon_graduation_cap,
  mic: m.schedule_icon_mic,
  monitor: m.schedule_icon_monitor,
  'map-pin': m.schedule_icon_map_pin,
}
