import { FileClock, FileSearch, FolderOpen, Star } from 'lucide-react'
import { defineModule, preloadable, type QueryKeyPrefix } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { QuickOpenPicker } from './cards/QuickOpenPicker'
import { quickOpenSchema } from './cards/quick-open'
import { prefetchFilesPage } from './queries'

const LISTS = ['filesItemList', 'filesItemGet'] as const
const PAGES = ['filesDocumentRead', 'filesDocumentOutline'] as const

/**
 * What each event can change. Creating or renaming a folder only changes the list; search shows names and
 * files still being processed; a document's pages only change when it is switched or goes away.
 */
const INVALIDATIONS = {
  'files.item.created': [...LISTS, 'filesUsageGet', 'filesDocumentSearch'],
  'files.item.updated': [...LISTS, 'filesDocumentSearch'],
  'files.item.deleted': [...LISTS, 'filesUsageGet', 'filesDocumentSearch', ...PAGES],
  'files.document.ready': [...LISTS, 'filesDocumentSearch', ...PAGES],
  'files.document.failed': [...LISTS, 'filesDocumentSearch'],
  'files.folder.created': ['filesItemList'],
  'files.folder.updated': ['filesItemList'],
  // A recursive delete takes its files with it.
  'files.folder.deleted': [...LISTS, 'filesUsageGet', 'filesDocumentSearch', ...PAGES],
  'academics.course.deleted': [...LISTS, 'filesUsageGet', 'filesDocumentSearch', ...PAGES],
} satisfies Record<string, readonly QueryKeyPrefix[]>

/**
 * M07 文件与文档管线: course files and links, previews, and the document pipeline that makes them
 * searchable. Other modules show sources with `<Citation>` (`./components/Citation`).
 */
export default defineModule({
  id: 'files',
  kind: 'core',
  name: m.files_name_module,
  description: m.files_description,
  icon: FolderOpen,
  pages: [
    {
      id: 'files',
      scopes: ['course', 'term'],
      title: m.files_nav,
      icon: FolderOpen,
      component: preloadable(() => import('./pages/FilesPage')),
      prefetch: prefetchFilesPage,
      order: 30,
    },
  ],
  cards: [
    {
      id: 'files.quickOpen',
      scopes: ['term', 'course'],
      title: m.files_card_quick_open,
      description: m.files_card_quick_open_description,
      icon: Star,
      sizes: ['s', 'm', 'l'],
      defaultSize: 's',
      component: preloadable(() => import('./cards/QuickOpenCard')),
      multiple: true,
      settings: { schema: quickOpenSchema, component: QuickOpenPicker },
    },
    {
      id: 'files.recent',
      scopes: ['course'],
      title: m.files_card_recent,
      description: m.files_card_recent_description,
      icon: FileClock,
      sizes: ['m'],
      defaultSize: 'm',
      component: preloadable(() => import('./cards/RecentCard')),
      multiple: false,
    },
  ],
  settingsSections: [
    {
      id: 'files',
      level: 'program',
      group: 'data',
      title: m.files_settings_title,
      icon: FileSearch,
      order: 10,
      namespace: 'files',
    },
    {
      id: 'course-files',
      level: 'course',
      group: 'general',
      title: m.files_settings_title,
      icon: FileSearch,
      order: 50,
      namespace: 'files',
    },
  ],
  jobKinds: [
    { kind: 'files.process', title: m.files_job_process },
    { kind: 'files.reindex_vectors', title: m.files_job_reindex },
  ],
  uiPrefPrefixes: ['files.'],
  realtimeInvalidations: INVALIDATIONS,
})
