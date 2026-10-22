import { FileClock, FolderOpen, Star } from 'lucide-react'
import { defineModule, preloadable } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { QuickOpenPicker } from './cards/QuickOpenPicker'
import { quickOpenSchema } from './cards/quick-open'
import { prefetchFilesPage } from './queries'

/** Queries that show files; any change to a file, a folder or the course behind them refetches them. */
const FILES_QUERIES = [
  'filesItemList',
  'filesItemGet',
  'filesUsageGet',
  'filesDocumentSearch',
  'filesDocumentRead',
  'filesDocumentOutline',
] as const

const FILES_EVENTS = [
  'files.item.created',
  'files.item.updated',
  'files.item.deleted',
  'files.document.ready',
  'files.document.failed',
  'files.folder.created',
  'files.folder.updated',
  'files.folder.deleted',
  'academics.course.deleted',
] as const

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
  jobKinds: [
    { kind: 'files.process', title: m.files_job_process },
    { kind: 'files.reindex_vectors', title: m.files_job_reindex },
  ],
  realtimeInvalidations: Object.fromEntries(FILES_EVENTS.map((event) => [event, FILES_QUERIES])),
})
