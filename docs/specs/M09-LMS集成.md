# M09 LMS 集成（核心模块，多 Provider）

> 依赖：M00、M02、M03、M04、M05、M07、M08、M11。被依赖：M16（Canvas Tab 插件）、M12、M13。
> 核心模块（`kind: 'core'`，id `lms`），不需要安装，所有用户可用。后端 `modules/lms/`，前端 `modules/lms/`。
> 设计与旧版一致：**LMS 集成是一个与具体平台无关的模块，通过 Provider 接入各个平台**。目前只实现 Canvas Provider；以后加 Moodle、Brightspace 等平台时只需新增 provider，不改模块本身、数据模型和界面框架。
> 课程内浏览 Canvas 内容的页面不属于本模块，由插件 **M16 Canvas Tab** 提供，它只消费本模块的读取接口。

## 1. 目标与功能对齐
旧版功能（保留）：
- **LMS 连接**（旧 `lms_integrations`）：每个用户可有多个连接，每个连接属于一个 provider，包含显示名、provider 配置（Canvas 为实例地址）和凭证（Canvas 为访问令牌）。保存前先验证；界面显示连接状态、最后检查时间和最后一次错误；凭证只显示掩码。
- **Program 绑定连接**（旧 `Program.lms_integration_id`）：每个 Program 可以绑定一个 LMS 连接。只要该 Program 下还有课程关联，就不能更换或解除绑定（旧 `PROGRAM_LMS_DEPENDENCIES_EXIST`）。
- **课程关联**（旧 `course_lms_links`）：一门课程最多关联一个外部课程。关联必须使用所属 Program 绑定的连接（旧 `PROGRAM_LMS_NOT_CONFIGURED`）。同一 Program、同一连接下，一个外部课程只能关联一门课程（解决旧 issue #17 重复导入）。每个关联有同步开关、外部课程代码和名称、最后同步时间与错误；可以手动"同步"刷新外部课程元数据。
- **从 LMS 批量导入课程**（旧 `import_program_courses`）：名称取外部课程名，别名取课程代码，分类从课程代码推断，学分取默认值，可选择目标学期；导入时同时建立课程关联。
- **读取接口**：导航、公告、作业、成绩、单元及条目、文件（元数据与内容）、页面、测验、syllabus。这些接口与平台无关，Canvas Tab 插件和 Agent 都使用它们。
- **作业导入为成绩簿考核**（一次性导入）。
- **学期日历叠加**：开启同步的已关联课程，其作业截止时间与 LMS 日历事件显示在日历中（旧 event-core 的 LMS 日历源；按 provider 批量请求，Canvas 使用 context codes）。
- 设置界面：连接管理（Provider 选择、Provider 专属表单与 logo），课程设置中的关联管理，Program 设置中的连接绑定。
- 出站请求防 SSRF；凭证加密存储并带版本号。

新增：
- 作业可以导入为**考核**或**待办**，在审核时切换。
- LMS 文件可以"保存到课程文件"，进入 M07 文档管线，之后可被检索和抽取。
- LMS syllabus 一键交给 M08 智能抽取。
- 导入后检测更新：截止时间或分值变化时提示"有 N 项更新"。
- 公告卡片。

## 2. Provider 框架
### 2.1 注册与描述
```python
register_lms_provider(CanvasProvider())

class LmsProvider(Protocol):
    kind: str                          # 'canvas'
    display_name: str                  # 'Canvas'
    config_model: type[BaseModel]      # Canvas: { base_url: HttpUrl }
    credentials_model: type[BaseModel] # Canvas: { access_token: SecretStr }
    features: frozenset[LmsFeature]    # 见 2.2；不支持的功能返回 lms.feature_unsupported

    def normalize_config(self, raw: dict) -> BaseModel          # 规范化与校验，失败抛 lms.invalid_config
    def normalize_credentials(self, raw: dict) -> BaseModel
    def mask_credentials(self, creds) -> dict[str, str]          # 只返回掩码，如 "7~ab…xy"
    async def validate(self, cfg, creds) -> ConnectionSummary   # 账户名、头像、实例名
    async def list_courses(self, cfg, creds, *, include_past: bool) -> list[LmsCourse]
    async def get_course(self, cfg, creds, course_id) -> LmsCourse   # code、name、term、start/end、default_view、web_url
    async def navigation(self, cfg, creds, course_id) -> list[NavTab]  # kind: 内置页签类型或 'external' / 'unknown'
    async def announcements(self, cfg, creds, course_id, *, since=None) -> list[Announcement]
    async def assignments(self, cfg, creds, course_id) -> list[Assignment]  # due_at、points、group、web_url、submission 状态、updated_at
    async def grades(self, cfg, creds, course_id) -> list[GradeItem]
    async def modules(self, cfg, creds, course_id) -> list[Module]
    async def module_items(self, cfg, creds, course_id, module_id) -> list[ModuleItem]
    async def pages(self, cfg, creds, course_id) -> list[PageSummary]
    async def page(self, cfg, creds, course_id, page_ref) -> PageDetail
    async def quizzes(self, cfg, creds, course_id) -> list[Quiz]
    async def syllabus(self, cfg, creds, course_id) -> RichText
    async def file(self, cfg, creds, course_id, file_id) -> FileMeta
    async def open_file(self, cfg, creds, course_id, file_id) -> AsyncIterator[bytes]
    async def calendar_events(self, cfg, creds, course_ids, start, end) -> list[LmsCalendarEvent]  # 一次请求多个课程
```
- 所有返回值都是本模块定义的、与平台无关的 DTO（`schemas/dto.py`），provider 负责把平台数据映射过来。DTO 带 `external_id`、`web_url`（在原平台打开）和 `raw_kind`（调试用）。
- HTML 内容（页面、公告、syllabus、作业描述）由**模块**统一清洗，provider 只负责取回原文。清洗使用 `nh3`：允许基本排版、表格、图片和链接；链接加 `rel="noopener noreferrer" target="_blank"`。provider 可以提供 `rewrite_internal_link(url) -> InternalRef | None`，把平台内部链接改写为内部引用（如 `{kind:'page', ref}`），供插件在应用内跳转。
- 错误映射由 provider 实现，但只能抛本模块定义的错误码（第 9 节）。
- 前端也有对应的 provider 注册：扩展点 **`lms.providerUi`**，每个 provider 贡献 `{ kind, label, logo, ConfigForm, credentialHelp }`。表单字段校验与后端 `config_model`/`credentials_model` 一致，由 OpenAPI 生成的类型约束。

### 2.2 功能标志 `LmsFeature`
`courses`、`navigation`、`announcements`、`assignments`、`grades`、`modules`、`pages`、`quizzes`、`syllabus`、`files`、`calendar`。`lms.provider.list` 返回每个 provider 的功能标志，界面根据它隐藏不支持的入口。Canvas 全部支持。

### 2.3 Canvas Provider（`modules/lms/providers/canvas/`）
- Canvas REST API v1，认证使用 `Authorization: Bearer <token>`，按 `Link` 头分页（单次最多 50 页，超出后截断并在结果中标记 `truncated`）。
- 配置 `base_url` 的规范化与旧版一致：没有协议时补 `https://`；只允许 http/https（托管版只允许 https）；拒绝查询串和片段；拒绝 `/api/v1` 路径；去掉末尾斜杠。访问令牌校验：不含空白和 `@`，长度至少 8。
- 所有请求都通过 `core.http.safe_client()`。文件下载跟随的重定向只允许同源或 Canvas 文件 CDN，每一跳都要在解析后检查不是私网地址。
- `navigation` 映射 Canvas tabs：`home`、`announcements`、`assignments`、`grades`、`modules`、`pages`、`quizzes`、`syllabus`、`files`、`discussions` 映射为对应的内置类型，`type=external` 映射为 `external`，其它映射为 `unknown`。
- `calendar_events` 用 `context_codes[]=course_<id>` 批量请求，同时获取 `type=event` 与 `type=assignment`。
- 错误映射：带 `WWW-Authenticate` 的 401 → `lms.invalid_credentials`；不带的 401（已登录但某个页面或文件被锁）和普通 403 → `lms.forbidden`；403 且正文含 `Rate Limit Exceeded` 或 `X-Rate-Limit-Remaining` 已降到 0 → `lms.rate_limited`（Canvas 默认用 403 限流，站点开启后才用 429；没有 `Retry-After`，按 60 秒）；429 → `lms.rate_limited`（带 `retry_after`）；404 → `common.not_found`；网络错误或超时 → `lms.unreachable`；私网地址 → `lms.blocked_address`。

### 2.4 读缓存
所有读取接口都经过模块级缓存：先查进程内 LRU，再查 SQLite `lms_cache`，TTL 5 分钟。缓存键为 `(user_id, connection_id, 方法, 参数)`，凭证更新时清除该连接的全部缓存。请求带 `?refresh=true` 时绕过缓存。

## 3. 领域模型
```
lms_connections
  id, user_id, provider, display_name,
  config_json,                       # provider 规范化后的配置（非敏感）
  credentials_encrypted,             # core.security.encrypt，带密钥版本前缀
  credentials_hint_json,             # mask_credentials 的结果
  account_name?, status ('connected'|'error'), last_checked_at?, last_error_code?,
  created_at, updated_at
  INDEX(user_id, provider)

lms_program_bindings                 # Program 绑定的连接（本模块自有表，不改 M02 的 programs）
  program_id (PK), user_id, connection_id, created_at, updated_at

lms_course_links
  id, user_id, course_id (unique), program_id, connection_id,
  external_course_id, external_code?, external_name?, external_term?, web_url?,
  sync_enabled (default true), last_synced_at?, last_error_code?, created_at, updated_at
  UNIQUE(program_id, connection_id, external_course_id)

lms_imported_refs                    # 已导入的作业/事件，用于去重和更新检测
  id, user_id, link_id, external_kind ('assignment'|'calendar_event'), external_id,
  target_kind ('assessment'|'task'|'event'), target_id, external_updated_at, imported_at
  UNIQUE(link_id, external_kind, external_id, target_kind)

lms_cache  key, user_id, connection_id, payload, expires_at
```
规则：
- 课程关联的 `connection_id` 必须等于课程所属 Program 的绑定连接，否则返回 `lms.program_not_configured`。
- Program 已有关联时更换或删除绑定 → `lms.program_has_links`（params: count）。
- 删除连接：要求该连接没有 Program 绑定。界面提供"同时解除所有绑定与关联"选项，选择后在同一事务中解除；已导入的考核、待办、文件保留。
- 年课（跨多个学期的一门课程）只有一个关联，这与 M02 的课程模型一致。

## 4. 同步语义
- **不做持续镜像**：
  - 浏览类数据（公告、单元、页面等）实时读取，有缓存。
  - **课程同步**（`lms.course.link.sync`，旧 `sync_course_link`）只刷新关联本身的外部元数据（代码、名称、学期、web_url），不修改课程本身。
  - 作业导入是一次性的。之后 `lms.course.check_updates` 对比 `lms_imported_refs.external_updated_at`，如果截止时间、分值或名称变化，在成绩页和 Canvas Tab 显示"有 N 项更新"。用户确认后生成一个 M08 session，其 items 为更新类 item，审核后才写入。
  - 日历叠加：`lms.events` 日历源实时读取 `sync_enabled=true` 的已关联课程（每个连接合并为一次 `calendar_events` 调用）。已导入为考核或待办的作业不重复显示。
- `sync_enabled=false`：该课程不出现在日历叠加中，也不做更新检测；读取接口和 Canvas Tab 仍然可用。
- 定时任务 `lms.refresh_status`（每 6 小时）：验证所有连接是否仍然有效，失效时标记为 error 并通过 SSE 发出 `lms.connection.status_changed`。

## 5. Capabilities
| name | effect | http | 说明 |
|---|---|---|---|
| `lms.provider.list` | read | GET /lms/providers | provider 列表、功能标志、配置字段 schema |
| `lms.connection.list` | read | GET /lms/connections | 凭证只返回掩码；`expose=("http",)` |
| `lms.connection.create` | write | POST /lms/connections | 先验证再保存；`expose=("http",)` |
| `lms.connection.update` | write | PATCH /lms/connections/{id} | 修改凭证时重新验证；`expose=("http",)` |
| `lms.connection.delete` | destructive | DELETE /lms/connections/{id} | 参数 `detach_all`；`expose=("http",)` |
| `lms.connection.validate` | read | POST /lms/connections:validate | 保存前测试；`expose=("http",)` |
| `lms.program.binding.get` / `.set` / `.clear` | read / write / write | GET/PUT/DELETE /programs/{id}/lms-binding | 规则见第 3 节 |
| `lms.course.list` | read | GET /programs/{id}/lms/courses | 使用该 Program 绑定的连接列出外部课程，标记是否已关联及关联到哪门课程 |
| `lms.course.link.get` | read | GET /courses/{id}/lms-link | |
| `lms.course.link.set` | write | PUT /courses/{id}/lms-link | 参数 external_course_id、sync_enabled；冲突 → `lms.course_already_linked`（params: course_id） |
| `lms.course.link.update` | write | PATCH /courses/{id}/lms-link | 修改 sync_enabled |
| `lms.course.link.sync` | write | POST /courses/{id}/lms-link:sync | 刷新外部元数据 |
| `lms.course.link.delete` | write | DELETE /courses/{id}/lms-link | |
| `lms.course.overview` | read | GET /courses/{id}/lms | 课程信息、导航、default_view、provider、功能标志 |
| `lms.announcement.list` | read | GET /courses/{id}/lms/announcements | |
| `lms.assignment.list` | read | GET /courses/{id}/lms/assignments | 每项标记已导入及导入目标 |
| `lms.grade.list` | read | GET /courses/{id}/lms/grades | |
| `lms.module.list` / `lms.module_item.list` | read | GET /courses/{id}/lms/modules[/{module_id}/items] | |
| `lms.page.list` / `lms.page.get` | read | GET /courses/{id}/lms/pages[/{ref}] | 返回清洗后的 HTML |
| `lms.quiz.list` | read | GET /courses/{id}/lms/quizzes | |
| `lms.syllabus.get` | read | GET /courses/{id}/lms/syllabus | |
| `lms.file.get` | read | GET /courses/{id}/lms/files/{file_id} | 元数据 |
| 文件内容代理 | — | GET /courses/{id}/lms/files/{file_id}/content | `routes.py`，流式代理，用于预览和下载 |
| `lms.file.save_to_course` | write | POST /courses/{id}/lms/files/{file_id}:save | 调用 M07 `save_bytes_as_file`，`source_kind='lms'`，`source_ref={provider, connection_id, file_id}` |
| `lms.course.import` | write | POST /programs/{id}/lms/imports:courses | 选中的外部课程（可选目标学期）→ M08 session（course items，带关联信息），返回 session id |
| `lms.assignment.import` | write | POST /courses/{id}/lms/imports:assignments | 选中的作业 → M08 session（默认类型为考核；assignment group → 分类；权重按 group weight 推算，无法推算时留空由用户填写） |
| `lms.syllabus.import` | write | POST /courses/{id}/lms/imports:syllabus | syllabus HTML → M08 文本抽取 session |
| `lms.course.check_updates` | read | GET /courses/{id}/lms/updates | |
| `lms.course.apply_updates` | write | POST /courses/{id}/lms/updates:review | 生成 M08 更新 session |

- 课程级读取接口要求该课程已关联（否则 `lms.course_not_linked`），并检查 provider 功能标志（否则 `lms.feature_unsupported`）。
- M08 提交时，item 的 `data.lms_ref` 带回外部引用。本模块订阅 `imports.session.committed`，写入 `lms_imported_refs`。导入课程时也在同一个提交里创建 `lms_course_links`（M08 的 course item 带 `data.lms_link`，本模块在 `imports.session.committing` 钩子里写入，保证在同一事务中）。

## 6. 事件与扩展
- 订阅：`academics.course.deleting`（删除关联与导入记录）、`academics.program.deleting`（删除绑定）、`grading.assessment.deleting` / `tasks.task.deleting`（删除对应的导入记录，之后可以再次导入）。
- 发出：`lms.connection.status_changed`、`lms.course.linked`、`lms.course.unlinked`。
- 贡献：
  - 日历源 `lms.events`（M04 `calendarSources`）：在日历筛选面板中按连接显示；事件描述默认以纯文本显示，用户可以在源设置中开启"渲染 HTML 描述"（清洗后，开启前确认，与旧版一致）。
  - `academics.termWizardImportSources`：学期向导中的"从 LMS 导入课程"（要求 Program 已绑定连接，否则引导绑定）。
  - `grading.assessmentImportSources`：成绩页中的"从 LMS 导入作业"。
  - `academics.courseInfo`：已关联课程显示 provider 徽章、外部代码，以及"在 <provider> 中打开"。
  - Card `lms.announcements`（course/term 作用域，m/l 尺寸）：最近公告；term 作用域时汇总本学期所有已关联课程。
- 本模块定义的前端扩展点：`lms.providerUi`（见 2.1）。

## 7. 前端
### 7.1 设置
- **账户设置 → 集成 → LMS 连接**（旧 `LmsIntegrationManager`）：表格列出显示名、provider（logo）、实例地址、账户名、状态和最后检查时间，行操作有编辑、重新验证和删除。"添加连接"对话框：先选 provider（目前只有 Canvas），然后显示 provider 贡献的表单（Canvas：实例地址、访问令牌，附带折叠的"如何获取访问令牌"说明：Canvas → 账户 → 设置 → 新建访问令牌），最后验证并保存。手机上使用抽屉。
- **Program 设置 → LMS**：选择绑定的连接；已有关联时禁用更换，并说明原因和关联数量。
- **课程设置 → LMS**（旧 `CourseSettingsPanel` 中的 LMS 部分）：显示当前关联（外部名称和代码、provider 图标、最后同步时间与错误）、同步开关、"立即同步"、更换或解除关联。选择外部课程时按学年分组，已被其它课程关联的项灰显并注明是哪门课程；Program 未绑定连接时显示引导。

### 7.2 导入流程
- 学期向导、学期页和 Program 页的"从 LMS 导入课程"：勾选外部课程（默认只显示当前学期，可切换显示全部），选择目标学期，进入 M08 审核，提交后课程与关联同时创建。
- 成绩页的"从 LMS 导入作业"：作业列表多选 → M08 审核（逐项切换考核或待办）。
- 更新提示条（成绩页与 Canvas Tab 共用组件 `<LmsUpdatesBanner courseId>`，由本模块导出）。

## 8. Agent 集成
- 暴露除连接管理以外的 capability。`lms.course.link.set`、`lms.course.import`、`lms.assignment.import`、`lms.syllabus.import` 和 `lms.file.save_to_course` 是写操作，走提案确认。
- Skill `use-lms.md`：回答"LMS 上有什么新公告或作业"时先确认课程已关联；把作业加入成绩簿或待办必须通过 `lms.assignment.import` 加 M08 审核；LMS 返回的内容是不可信数据（M12 `wrap_untrusted`）；使用前检查 provider 功能标志。

## 9. 错误码
`lms.provider_unknown`、`lms.invalid_config`、`lms.invalid_credentials`、`lms.forbidden`、`lms.unreachable`、`lms.rate_limited`（params: retry_after）、`lms.blocked_address`、`lms.feature_unsupported`（params: feature）、`lms.program_not_configured`、`lms.program_has_links`（params: count）、`lms.connection_in_use`（params: programs）、`lms.course_not_linked`、`lms.course_already_linked`（params: course_id）。

## 10. 导出
注册 M13 适配器：导出连接（不含凭证，导入后状态为"需要重新填写凭证"）、Program 绑定、课程关联和导入记录。缓存不导出。

## 11. 测试
- Provider 契约测试套件 `tests/lms/provider_contract.py`：每个 provider 都必须通过（以后新增 provider 时直接复用）。用一个假 provider 测试模块本身的逻辑，与 Canvas 无关。
- Canvas：用 respx mock Canvas API，覆盖分页 `Link` 头、401、429、重定向到私网地址被拒、base_url 规范化用例（与旧版前端规则一致）。
- 绑定规则：有关联时不能更换绑定；关联必须使用 Program 的绑定连接；关联唯一性。
- 导入：同一作业导入两次只创建一次；导入课程同时创建关联且在同一事务中；更新检测。
- 日历：`sync_enabled=false` 的课程不出现；已导入作业不重复；多课程合并为一次请求。
- HTML 清洗：去掉 script/style/事件属性；内部链接改写。
- 凭证：任何响应和日志中都不出现明文。

## 12. 验收
- 添加 Canvas 连接并绑定到 Program 后，在学期向导中能一次性导入本学期全部课程，课程自动关联。
- 导入作业后，日历中不出现重复的截止事件。
- 用假 provider 跑通全部模块测试，证明新增 provider 不需要修改模块代码。

## 实现说明（M09 落地时补充）
以下是实现时做出的取舍与对上文的细化，以代码为准。

**后端**
- 导入流程直接用 M08 的 session，所以 M09 在 M08（#32）之后合并。迁移号 `0013`，在 M08 的 `0012` 之后。
- Provider 方法的第一个参数是 `io`（`providers/base.py` 的 `Io`：共享的安全出站客户端、配置、`truncated` 标记），`normalize_config` 额外接收 `settings`（判断是否允许 http 和私网地址）。Canvas 的文件下载只跟随同源或 Canvas 文件 CDN（`.instructure.com`、`.canvas-user-content.com`、`.inscloudgate.net`、`instructure-uploads.s3.amazonaws.com`）的重定向，令牌只发给同源；每一跳都检查目标地址是否公网。分页只跟随同源的 `Link: rel=next`，最多 50 页，超出时返回 `truncated: true`。
- 凭证以 `v1:<Fernet 密文>` 存在 `credentials_encrypted`，响应里只有 `credentials_hint`（掩码）和 `has_credentials`。新增错误码 `lms.credentials_missing`（409）：数据导入后或密钥轮换后凭证无法解密时出现，界面提示重新填写。`lms.invalid_credentials` 用 400 而不是 401，避免触发前端的"会话已过期"对话框。
- 修改连接的配置（例如地址）时必须重新填写凭证，否则返回 `lms.credentials_missing`：已保存的令牌永远不会发往新地址。令牌格式不对时返回 `lms.invalid_credentials`（reason `format`）。
- 课程导入的 session 提交时，如果学业项目已经换绑到别的连接，课程照常创建，但不建立关联（关联必须使用当前绑定的连接）。
- 定期任务 `lms.refresh_status`（每 6 小时）重新验证连接状态并清理过期缓存；读缓存在内存 LRU（`app.state.lms`）和表 `lms_cache` 两层，TTL 5 分钟，`refresh=true` 跳过缓存。
- `lms_imported_refs` 多了 `snapshot`（导入时作业的标题、截止时间、分值，以及按作业组推算的实际权重），用于更新检测；`check_updates` 比较的是快照与平台当前值，所以组权重或同组其他作业分值变化也会作为权重更新提示。旧快照没有权重字段时不比较权重。分值变化只在作业组加权的课程里提示（导入不复制分值，未加权课程的分值变化在本地没有可应用的字段）。审核提交时，应用失败的修改项不刷新快照，下次仍会提示。读取平台内容时遇到 `lms.forbidden` 只说明那一项资源没权限，不会把连接标成失效；连接检查（读取本人资料）遇到 403 仍算连接错误。“显示往期课程”时 Canvas 课程列表会额外请求一次 `enrollment_state=completed` 并按 id 去重，因为不带该参数时只返回当前的选课。作业成绩带上 submission 的 `graded_at`。测验列表只含 Classic Quizzes（New Quizzes 是 LTI 作业，暂未识别为测验）；讨论 checkpoint（`type=sub_assignment`）暂不进日历；学期公告卡片仍按课程分别请求，后续可合并成一次多 `context_codes[]` 请求。作业导入或更新审核的 session 未提交期间，课程被取消关联或改关联到另一门平台课程时，提交会整体回滚并返回 `lms.course_not_linked`。
- 导入记录不是订阅 `imports.session.committed` 写的，而是 `register_commit_hook("lms", ...)`：与 M08 提交在同一事务里创建课程关联、写导入记录、刷新快照，提交失败时一起回滚。LMS 侧的对应关系存在 session 的 `source_meta.lms.items`（item id → 外部 id），因为 M08 的 item 数据模型会丢掉未知字段。
- 作业导入按作业组生成 `category` item（`weight_total` 为组权重），考核权重 = 组权重 × 本作业分值占比；课程没开启作业组权重或算不出来时权重为空、置信度为 low，由用户在审核里补。已导入过的作业不再出现在可导入列表里（全部已导入时返回 `import.no_content`）。
- **对 M08 的改动**（M08 规格同步补充）：新 item 类型 `assessment_patch` / `task_patch`（字段级对比，`label` 用于在审核里显示名称），`imports.item.update` 可以传 `type` 在 `assessment` 与 `task` 之间切换（字段按对方的模型转换，切到考核要求有课程；对方没有的字段存进 `held`，切回来时恢复，权重与分类不会丢）。
- 订阅改为 `tasks.item.deleted`（提交后）而不是 `tasks.task.deleting`，因为 M05 发的是这个事件；删除导入记录后同一作业可以再次导入。
- `lms.file.save_to_course` 通过 `importlib` 调 M07 的 `save_bytes_as_file`，M07 还没合并时返回 `lms.feature_unsupported`（feature `save_to_course`）。
- 日历源 `lms.events`：描述只显示纯文本（`meta.note`），"渲染 HTML 描述"开关没有做；`meta.url` 指向平台上的原事件。
- M13 适配器在 `lms/portability.py`（导出连接但不含凭证，导入后状态为 `lms.credentials_missing`；绑定、关联、导入记录按 id 映射；缓存不导出），在文件底部用 M13 的 `register_portability` 注册。

**前端**
- 账户设置"集成"组下的"LMS 连接"沿用 AI 服务商分区的列表行样式（`Item` 行 + 行内按钮），没有用表格；手机端仍是对话框，没有做抽屉。删除正在使用的连接时确认框说明会解除多少关联，确认后以 `detach_all=true` 删除。
- 学业项目设置与课程设置的 LMS 分区都在"集成"组。更换关联课程前有确认框：旧关联的导入记录会被清除（之后不再检测这些作业的变化）。课程设置里选择外部课程按平台学期分组（当前学期在前），被其它课程关联的项灰显并写明是哪门课程。
- 新扩展点：`lms.providerUi`（本模块定义，`{ kind, label, logo, description?, summary?, ConfigForm, credentialHelp, isComplete }`；`description` 是选择服务商时名称下的一行说明，`summary(config)` 给出连接行上除名称外的标识，Canvas 是实例地址）、`academics.courseInfoRows`（课程信息卡片的额外行，用于显示服务商徽章和"在 Canvas 中打开"）、`grading.courseGradesBanners`（成绩页顶部提示，`LmsUpdatesBanner` 挂在这里）。
- M08 的 `openImport` 新增两种请求：`source: 'picker'`（来源自己创建 session 的第一步，例如 LMS 课程/作业选择）和 `source: 'session'`（已有 session 直接进入审核，例如作业变更）。学期向导的来源用 M08 导出的 `wizardImportSource` 包装，所以 LMS 课程也走"向导创建课程 → 提交 session"的流程，关联在提交时创建。向导路径下课程只带课程号和名称，平台上的课程全名（alias）和网址不会写入。
- **前端不写死 Canvas**（UIUX 第三轮）：连接列表每行显示服务商图标与名称（`useProviderName`：provider UI 的 `label`，没有前端贡献时退回后端 `lms.provider.list` 的 `display_name`）；"添加连接"对话框第一步总是选服务商（服务商列表随连接列表预取，加载中是一行 Skeleton，没有可用服务商时显示 Empty；列出后端提供、且前端有 `lms.providerUi` 贡献的服务商，目前只有 Canvas 也照样走这一步），第二步是该服务商贡献的表单，可"返回"重选，标题为"添加 {provider} 连接"；编辑时服务商固定。学业项目设置的连接下拉也带服务商图标。通用文案都从服务商名称取："从 {provider} 导入课程"、"{provider} 作业"、"{provider} 课程"、"{provider} 上没有课程/作业"、"在 {provider} 中打开"、变更提示条。学期向导与成绩页"导入"菜单里的名称依赖当前学业项目绑定的服务商，因此 M02 的 `TermWizardImportSource` 和 M03 的 `AssessmentImportSource` 新增可选 `Title` 组件（拿到 `programId`/`courseId` 后渲染）和 `query`（宿主随页面预取 `Title` 要读的数据，打开菜单时名称不再从 LMS 变成 Canvas），M08 的 `ImportPicker` 新增可选 `Title`；没有绑定或加载中时退回"从 LMS 导入课程"。命令面板的命令名称是静态字符串，仍是"从 LMS 导入课程"。
- "从 LMS 导入课程"目前入口是学期向导和学期页的命令面板（命令 `lms.import-courses`），学期页和学业项目页上没有单独的按钮。
- 公告卡片 `lms.announcements`（课程/学期，m/l）只列标题、课程和日期，点击在平台上打开；学期作用域汇总该学期所有已关联课程（暂停同步的课程也显示，同步开关只影响日历和变更检测）。
- 同一个作业只导入一次，不分考核还是任务：两个导入会话并行，一个已经把作业导成另一种类型时，后提交的整体回滚，报 `lms.assignment_already_imported`（409）。
- 保存连接（新建或改地址/令牌）与验证一样，资料接口 404 统一报 `lms.invalid_config`（`reason=not_canvas`），不会冒出 `common.not_found`。
- 连接坏掉的错误（标记 `error`）包括 `lms.invalid_config`：已保存的地址后来开始重定向或资料接口 404，说明它不再是 Canvas API。
- 两个课程导入会话选了同一门平台课程时，后提交的整体回滚（`lms.course_already_linked`），不会留下一门没关联的重复课程。
- 文件下载跳转到端口非法的地址时报 `lms.blocked_address`。
- 关联课程时先写入关联、再重读 Program 的绑定：查询平台期间绑定被改到别的连接时报 `lms.program_not_configured` 并回滚，不会留下走旧连接的关联。
- 平台返回的链接（`web_url`）只保留 http/https，其他协议（`javascript:` 等）在 DTO 校验时丢弃；日历里打开平台事件时前端也再检查一次。
