import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'
import { uiTranslations } from 'fumadocs-ui/i18n'
import { i18n } from './i18n'
import { appName, appUrl, gitConfig, landingUrl } from './shared'

export const translations = i18n
  .translations()
  .extend(uiTranslations())
  .add({
    en: { displayName: 'English' },
    zh: {
      displayName: '简体中文',
      'Back to Home(404 not found page)': '返回首页',
      'Choose a language(language switcher)': '选择语言',
      'Choose a language(language switcher)(aria-label)': '选择语言',
      'Close Banner(banner)(aria-label)': '关闭横幅',
      'Close Search(search dialog)(aria-label)': '关闭搜索',
      'Close Sidebar(aria-label)': '关闭侧边栏',
      'Close Sidebar(sidebar)(aria-label)': '关闭侧边栏',
      'Close(image zoom)(aria-label)': '关闭',
      'Collapse Sidebar(sidebar)(aria-label)': '收起侧边栏',
      'Copied Anchor Link(heading anchor)(aria-label)': '已复制链接',
      'Copied Link(accordion)(aria-label)': '已复制链接',
      'Copied Markdown(page actions)': '已复制 Markdown',
      'Copied Text(code block)(aria-label)': '已复制',
      'Copy Anchor Link(heading anchor)(aria-label)': '复制链接',
      'Copy Link(accordion)(aria-label)': '复制链接',
      'Copy Markdown(page actions)': '复制 Markdown',
      'Copy Text(code block)(aria-label)': '复制',
      'Dark(theme switcher)(aria-label)': '深色',
      'Default(type table)': '默认值',
      'Edit on GitHub(edit page)': '在 GitHub 上编辑',
      'Hide Sidebar(sidebar)': '隐藏侧边栏',
      'Image Viewer(image zoom)(aria-label)': '图片查看器',
      'Language(language switcher)': '语言',
      'Last updated on(page footer)': '最后更新于',
      'Light(theme switcher)(aria-label)': '浅色',
      'Next Image(image zoom)(aria-label)': '下一张',
      'Next Page(pagination)': '下一页',
      'No Headings(table of contents)': '没有标题',
      'No results found(search dialog)': '没有找到结果',
      'On this page(table of contents)': '本页内容',
      'Open Search(search trigger)(aria-label)': '打开搜索',
      'Open Sidebar(aria-label)': '打开侧边栏',
      'Open Sidebar(sidebar)(aria-label)': '打开侧边栏',
      'Open in ChatGPT(page actions)': '在 ChatGPT 中打开',
      'Open in Claude(page actions)': '在 Claude 中打开',
      'Open in Cursor(page actions)': '在 Cursor 中打开',
      'Open in GitHub(page actions)': '在 GitHub 中打开',
      'Open in Scira AI(page actions)': '在 Scira AI 中打开',
      'Open(page actions)': '打开',
      'Options(aria-label)': '选项',
      'Page Not Found(404 not found page)': '页面不存在',
      'Parameters(type table)': '参数',
      'Previous Image(image zoom)(aria-label)': '上一张',
      'Previous Page(pagination)': '上一页',
      'Prop(type table)': '属性',
      'Read {url}, I want to ask questions about it.(page actions)':
        '阅读 {url}，我想就它提几个问题。',
      'Returns(type table)': '返回值',
      'Search failed(search dialog)': '搜索失败',
      'Search failed, showing results for {query}(search dialog)':
        '搜索失败，以下是 {query} 的结果',
      'Search(search dialog)': '搜索',
      'Search(search trigger)': '搜索',
      'Show Sidebar(sidebar)': '显示侧边栏',
      'System(theme switcher)(aria-label)': '跟随系统',
      'Table of Contents(inline table of contents)': '目录',
      'The page you are looking for might have been removed, had its name changed, or is temporarily unavailable.(404 not found page)':
        '你要找的页面可能已被删除、改名或暂时不可用。',
      'Theme(site menu)': '主题',
      'Toggle Menu(home layout header)(aria-label)': '切换菜单',
      'Toggle Theme(theme switcher)(aria-label)': '切换主题',
      'Type(type table)': '类型',
      'View as Markdown(page actions)': '以 Markdown 查看',
    },
  })

export function baseOptions(lang: string): BaseLayoutProps {
  const zh = lang === 'zh'

  return {
    nav: {
      title: appName,
      url: `/${lang}`,
    },
    // `external` keeps them plain links, outside the docs' basePath. The landing page is English
    // at its root and Chinese under /zh/.
    links: [
      {
        text: zh ? 'Semestra 主页' : 'Semestra home',
        url: `${landingUrl}/${zh ? 'zh/' : ''}`,
        external: true,
      },
      { text: zh ? '打开应用' : 'Open app', url: `${appUrl}/login`, external: true },
    ],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  }
}
