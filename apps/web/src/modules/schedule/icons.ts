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
