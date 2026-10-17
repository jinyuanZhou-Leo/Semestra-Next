# M16 Canvas Tab（插件）

> 依赖：M00、M09（LMS 读取接口）、M10（Page、安装）、M11、M07（文件预览组件）。被依赖：无。
> 插件（`kind: 'plugin'`，id `canvas-tab`，`default_installed: false`），对应旧版 `builtin-canvas-integration` 插件。**只有前端**，没有自己的数据表和后端 capability，所有数据都来自 M09。
> 连接、Program 绑定、课程关联、导入和日历叠加都属于 M09 核心模块，不安装本插件也能使用。

## 1. 目标与功能对齐
旧版功能（保留）：在课程中浏览 Canvas 内容，不必离开 Semestra。
- 左侧导航栏镜像 Canvas 课程菜单；首页遵循 Canvas 的 `default_view`。
- 公告、作业、成绩（原生视图）、单元及条目、文件预览和下载、页面、测验列表、syllabus。
- 成绩页显示推荐卡片，引导用户到成绩簿计算 GPA。
- 隐藏 files 和 discussions 页签；未知内部页签显示"在 Canvas 中打开"；外部工具页签显示启动提示。

新增：
- 作业列表可以多选导入到成绩簿或待办（调用 M09 `lms.import.assignments`）。
- 单元中的文件条目可以"保存到课程文件"。
- Syllabus 页有"智能导入"按钮（M09 `lms.import.syllabus`）。
- 记住浏览位置，带更新提示条。

## 2. 注册
```ts
defineModule({
  id: 'canvas-tab', kind: 'plugin',
  pages: [{
    id: 'canvas-tab.course', scope: 'course', title: 'Canvas', icon: canvasLogo,
    // 只有关联到 canvas provider 连接的课程才显示
    isAvailable: ({ course, lmsLink }) => lmsLink?.provider === 'canvas',
    component: lazy(() => import('./CanvasCoursePage')),
  }],
  commands: [{ id: 'canvas-tab.openInCanvas', scope: 'course', ... }],
})
```
- `isAvailable` 的数据来自 M09 `lms.course.link.get`（已在课程布局查询中预取，避免额外请求）。
- 课程未关联时不显示 Page；课程设置中关联后自动出现（M10 Page 排序规则中排在末尾，可以拖动）。
- 插件详情页注明"需要先在设置中添加 Canvas 连接并关联课程"。

## 3. 页面结构
- 布局：左侧粘性导航栏（宽屏）或顶部下拉选择（窄屏），右侧内容区。顶部栏：课程外部名称和代码、"在 Canvas 中打开"、"刷新"（调用接口时带 `refresh=true`）、M09 导出的 `<LmsUpdatesBanner>`。
- 导航栏数据：`lms.course.overview.navigation`。显示规则：
  - 内置类型 `home`、`announcements`、`assignments`、`grades`、`modules`、`pages`、`quizzes`、`syllabus` 使用本插件的原生视图。
  - `files`、`discussions` 隐藏（与旧版一致）。
  - `external` → 启动提示卡（说明这是外部工具，按钮在新标签页中打开 Canvas 中对应的页签）。
  - `unknown` → "此页面暂不支持在 Semestra 中显示"，带"在 Canvas 中打开"按钮。
- 当前位置 `{ tab, detailRef? }` 存在 `useUiPref('canvas-tab.location.<courseId>')`，离开再回来时恢复；同时同步到 URL search 参数，可以分享或刷新。

## 4. 各视图
| 视图 | 数据 | 内容 |
|---|---|---|
| 首页 | `overview.default_view` | `wiki` → 首页 page；`modules` / `syllabus` / `assignments` → 对应视图；`feed` → 公告列表 |
| 公告 | `lms.announcements.list` | 列表（标题、作者、时间、未读点），详情显示清洗后的 HTML |
| 作业 | `lms.assignments.list` | 表格（名称、分组、截止、分值、提交状态、是否已导入），按分组折叠；多选"导入到成绩簿/待办" → M08 审核；行点击显示描述 |
| 成绩 | `lms.grades.list` | Canvas 得分列表；顶部推荐卡片"在成绩簿中计算 GPA 与目标"，跳转到 M03 成绩 Page |
| 单元 | `lms.modules.list` + `lms.module_items.list`（展开时懒加载） | 可展开的模块列表；条目内联渲染：页面（应用内打开）、文件（M07 预览组件 + 下载 + "保存到课程文件"）、外部链接（打开前确认）、作业（跳到作业视图对应行）、测验（跳到测验视图） |
| 页面 | `lms.pages.list` / `lms.page.get` | 列表与详情；内部链接改写后在插件内跳转 |
| 测验 | `lms.quizzes.list` | 列表（名称、截止、分值、题目数），在 Canvas 中打开 |
| Syllabus | `lms.syllabus.get` | 清洗后的 HTML；"智能导入"按钮 → `lms.import.syllabus` → 打开 M08 审核 |

- 渲染 HTML 时使用共享组件 `<SafeHtml>`（M00），再次过一遍前端净化（DOMPurify），图片懒加载，表格横向滚动。
- 每个视图都有加载骨架、空状态和错误状态（`lms.invalid_credentials` 时引导到连接设置重新填写令牌；`lms.rate_limited` 时显示稍后重试）。

## 5. 文案与可访问性
- 中英双语；导航栏使用 `nav` + `aria-current`；窄屏下拉可以用键盘操作。
- Canvas 页签名称直接显示 Canvas 返回的标签（这是用户学校的语言），插件自己的文案走 i18n。

## 6. 测试
- 导航镜像：内置、隐藏、external、unknown 四类页签的显示。
- `default_view` 各取值对应的首页。
- 位置恢复（UI 偏好与 URL）。
- 未关联或关联到非 canvas provider 时 Page 不可用。
- 导入、保存文件和智能导入按钮调用正确的 M09 capability（MSW mock）。

## 7. 验收
- 安装插件并关联课程后，在课程中能浏览公告、单元文件和 syllabus，体验与旧版 Canvas Tab 一致。
- 卸载插件后，M09 的连接、关联、导入和日历叠加不受影响。
