import { createElement } from 'react'
import {
  Apple,
  BookOpen,
  Bike,
  Brain,
  Code,
  Coffee,
  Droplets,
  Dumbbell,
  Flame,
  Footprints,
  Heart,
  Languages,
  Leaf,
  type LucideIcon,
  type LucideProps,
  Moon,
  Music,
  Pencil,
  Smile,
  Star,
  Sun,
  Target,
} from 'lucide-react'
import type { HabitIconName } from './schema'

const ICONS: Record<HabitIconName, LucideIcon> = {
  target: Target,
  'book-open': BookOpen,
  dumbbell: Dumbbell,
  droplets: Droplets,
  moon: Moon,
  sun: Sun,
  pencil: Pencil,
  music: Music,
  code: Code,
  coffee: Coffee,
  apple: Apple,
  brain: Brain,
  heart: Heart,
  footprints: Footprints,
  bike: Bike,
  languages: Languages,
  leaf: Leaf,
  flame: Flame,
  star: Star,
  smile: Smile,
}

export function habitIcon(name: string): LucideIcon {
  return ICONS[name as HabitIconName] ?? Target
}

/** A habit's icon as an element, so cards need no component of their own made during render. */
export function HabitIcon({ name, ...props }: { name: string } & LucideProps) {
  return createElement(habitIcon(name), props)
}
