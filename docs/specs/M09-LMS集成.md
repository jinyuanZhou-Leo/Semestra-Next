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
- **学期日历叠加**：开启同步的已关联课程，其 LMS 日历事件（不是作业）显示在日历中（按 provider 批量请求，Canvas 使用 context codes）。作业要导入才进日历：导入后成为考核（有截止日期就有待办）或待办，日历经 `tasks.due` 显示。
- 设置界面：连接管理（Provider 选择、Provider 专属表单与 logo），课程设置中的关联管理，Program 设置中的连接绑定。
- 出站请求防 SSRF；凭证加密存储并带版本号。

新增：
- 一个“导入”：有分值的作业成为**考核**（有截止日期就带待办），没有分值的成为**待办**；导入一律先进 M08 审核（可改分类、权重，也可切换类型），确认后才写入。只成为待办的作业可以“加入成绩簿”，待办保留。
- LMS 文件可以"保存到课程文件"，进入 M07 文档管线，之后可被检索和抽取。
- LMS syllabus 一键交给 M08 智能抽取。
- 后台同步（§4.1）：已导入的作业自动跟随平台，平台上的新作业、两边都改过的值和平台上已删除的项才询问用户。
- 公告卡片。

## 2. Provider 框架
### 2.1 注册与描述
内置 provider 在 `providers/__init__.py` 导入时注册，并注册术语 `{lms}`（`core/capability.py` 的 `register_term`）：Sem/MCP 看到的能力摘要与 skill 文字里写 `{lms}`，展开成「LMS (Canvas)」（接入第二个平台后自动带上），学生说“Canvas”时 `search_tools` 也能找到 LMS 工具，共享代码里不写死平台名（2026-11-13 后端评审）。

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
- HTML 内容（页面、公告、syllabus、作业描述）由**模块**统一清洗，provider 只负责取回原文。清洗使用 `nh3`：允许基本排版、表格、图片和链接；链接加 `rel="noopener noreferrer" target="_blank"`。清洗后所有链接和图片地址都补全为平台上的绝对地址（相对地址按条目自己的 `web_url` 解析，没有时用 provider 的 `web_base(cfg)`），否则在应用里会被解析成应用自己的地址（例如 Canvas 页面里的 `cover.html` 打开成应用的 404 页）。provider 可以提供 `rewrite_internal_link(url) -> InternalRef | None`（收到的已是绝对地址），把平台内部链接改写为内部引用（如 `{kind:'page', ref}`），供插件在应用内跳转。
- 错误映射由 provider 实现，但只能抛本模块定义的错误码（第 9 节）。
- 前端也有对应的 provider 注册：扩展点 **`lms.providerUi`**，每个 provider 贡献 `{ kind, label, logo, ConfigForm, isComplete }`（获取凭证的说明由 `ConfigForm` 自己渲染，随连接方式变化）。表单字段校验与后端 `config_model`/`credentials_model` 一致，由 OpenAPI 生成的类型约束。

### 2.2 功能标志 `LmsFeature`
`courses`、`navigation`、`announcements`、`assignments`、`grades`、`modules`、`pages`、`quizzes`、`syllabus`、`files`、`calendar`。`lms.provider.list` 返回每个 provider 的功能标志，界面根据它隐藏不支持的入口。Canvas 全部支持。

### 2.3 Canvas Provider（`modules/lms/providers/canvas/`）
- Canvas REST API v1，认证使用 `Authorization: Bearer <token>`，按 `Link` 头分页（单次最多 50 页，超出后截断并在结果中标记 `truncated`）。
- 配置 `base_url` 的规范化与旧版一致：没有协议时补 `https://`；只允许 http/https（托管版只允许 https）；拒绝查询串和片段；拒绝 `/api/v1` 路径；去掉末尾斜杠。访问令牌校验：不含空白和 `@`，长度至少 8。
- **凭证两种形态**：① 手填个人访问令牌（`access_token`，默认，托管版与自托管都可用）；② 自托管开启 `SEMESTRA_LMS_CANVAS_SIGN_IN` 后，可在学校登录页完成 SSO/MFA，把回调地址粘回应用（`sign_in.py`）。后者借用 Canvas 官方移动端 OAuth 客户端（`sso.canvaslms.com/api/v1/mobile_verify.json`），换到的 refresh token 长期有效，access token 临近过期或 401 时自动续期；续期后的凭证在请求提交后用单独短事务写回（与读缓存一样，不在读请求事务里写库）。关闭开关后不再续期：已有连接在 access token 过期后变为 `lms.invalid_credentials`，用户改填令牌；删除或更换这类连接时仍会尽力撤销（必要时用 refresh token 换一次 access token）。文件预览和下载与其它读取一样，遇 401 续期后重试一次。`credentials_hint` 为 `{method: "sign_in"}` 或令牌掩码。只允许 https（`lms.sign_in_https_required`）：换码和续期都会发送 client secret 与 refresh token。删除或更换凭证时，提交后尽力向 Canvas 撤销旧令牌：撤销需要有效的 access token，所以过期时先续期，遇 401 再续期重试一次；refresh token 已失效说明用户已在 Canvas 上移除，不算失败；其它失败只记日志。未验证：按 Canvas 开源代码，开发者密钥开了 `force_token_reuse` 时重新登录不返回 refresh token，换码以 `lms.sign_in_failed`（`no_token`）失败，旧连接不受影响（可删除后重连）；开了 `replace_tokens` 时登录会废掉同一密钥下的其它令牌，包括手机 App 的。移动端密钥是否开启这两项无法从外部确认。
- 所有请求都通过 `core.http.safe_client()`。文件下载跟随的重定向只允许同源或 Canvas 文件 CDN，每一跳都要在解析后检查不是私网地址。
- `navigation` 映射 Canvas tabs：`home`、`announcements`、`assignments`、`grades`、`modules`、`pages`、`quizzes`、`syllabus`、`files`、`discussions` 映射为对应的内置类型，`type=external` 映射为 `external`，其它映射为 `unknown`。
- `calendar_events` 用 `context_codes[]=course_<id>` 批量请求，只取 `type=event`（作业不进日历叠加）。
- 错误映射（归一结果见 §4.1 表 2）：带 `WWW-Authenticate` 的 401 → `lms.invalid_credentials`；不带的 401（已登录但某个页面或文件被锁）和普通 403 → `lms.forbidden`；403 且正文含 `Rate Limit Exceeded` 或 `X-Rate-Limit-Remaining` 已降到 0 → `lms.rate_limited`（Canvas 默认用 403 限流，站点开启后才用 429；没有 `Retry-After`，按 60 秒）；429 → `lms.rate_limited`（带 `retry_after`）；404 → `common.not_found`；网络错误或超时 → `lms.unreachable`；私网地址 → `lms.blocked_address`；学校登录未开启 → `lms.sign_in_disabled`；Canvas 不认识该校 → `lms.sign_in_unavailable`；学校登录用了 http 地址 → `lms.sign_in_https_required`；粘贴的回调无授权码/已过期 → `lms.sign_in_failed`。

### 2.4 读缓存
只有实时读取（表 1 里“读的时候从哪读”是“平台”的那几类）经过缓存：进程内 LRU（按字节限 64 MB），TTL 5 分钟（唯一的例外是 Sem 搜索读的页面正文，见 §8：带版本的键保留 14 天，只从单元得知的 1 小时；它们也只在这个进程内，重启后重新读），键为 `(user_id, connection_id, 方法, 参数)`，每条带范围 `course:<外部课程 id>`；凭证更新时清除该连接的全部缓存。缓存里只放 provider 交出的事实（DTO），不放派生值（§4.2），所以规则改了不会读到按旧规则算好的值。请求带 `?refresh=true` 时绕过缓存。没有数据库层（`lms_cache` 表删除，PR 4）：同步保存的数据本来就在库里，实时读的内容 5 分钟后过期，跨进程留着没有意义。

## 3. 数据：存在哪里，从哪里读
平台数据进入 Semestra 只有一条流水线：**provider 交出归一后的事实 → 同步把事实存进镜像表 → 读取一律读镜像，派生值在读取时由 `rules.py` 算出、跟着对象返回**。镜像里只存事实。只有表 1 里明确写“平台”的几类实时读取，它们不存，只在内存里缓存 5 分钟（§2.4），每一类都写了不存的理由。

“落地”一列：**现状** 表示 main 上已是这样；**PR n** 表示由 LMS 重构的第 n 个 PR 做到（计划见资料库《2026-11-22-LMS重构-PR计划.md》），在那之前代码与表不一致之处以表为准。

### 3.1 表 1：数据流
| 数据 | 真实来源 | 存在哪 | 谁写 | 读的时候从哪读（所有界面、Sem、MCP 都一样） | 刷新 | 落地 |
|---|---|---|---|---|---|---|
| 课程元数据（代码、名称、学期、地址） | 平台课程 | `lms_course_links` 的 `external_*`、`web_url` | 同步阶段 `course` | 镜像 | 排这门课的同步 | 现状 |
| 各区域这一轮的读取结果（表 2 的区域结果，含从课程导航得出的 `hidden`）、`unavailable` 的原因 `reason`、最后一次读回来的时间 `read_at` 与最后一次读全的时间 `whole_at` | 同步各阶段读区域列表的结果；`read_at` 在结果为 `whole`/`partial` 时、`whole_at` 在结果为 `whole` 时更新为这一轮的时间，其余结果沿用上次的值（一个写法：`rules.area_entry`） | `lms_course_links.area_reads` | 读这个区域的同步阶段 | 只有同步自己读（表 3c 的输入） | 每轮同步覆盖 | 现状 |
| 单独读取一项的最近一次结果 | 同步对单项的读取 | `lms_item_checks` | 读这一项的同步阶段 | 表 3c 的输入；因栏目关闭读不到的项列在同步面板的“暂时无法同步”（3c 注） | 每次单独读覆盖 | 现状 |
| 作业（说明、截止、开放与关闭时间、分值、作业组、提交方式、测验的事实） | 平台作业列表 | `lms_assignments`（关联课程的全部作业，不只已导入的；§3.2） | 同步阶段 `assignments` | 镜像：作业详情、成绩册作业列、待办卡片、Canvas 标签页的作业与测验视图、`lms.assignment.list`、Sem、MCP；镜像替不了平台时实时读（见下面的“镜像优先”） | 界面：排这门课的 `assignments` 阶段；接口、Sem、MCP：`refresh=true` 实时读平台现在的样子（不存） | PR 4（现在：未导入的作业实时读，已导入的另存 `lms_imported_refs.snapshot` 与 `lms_kept_assignments`） |
| 我的提交与老师反馈（提交时间、得分、等级、是否等批改、免交、缺交、迟交、评语、评分细则得分、提交的文件名） | 平台提交列表（整门课一次） | `lms_assignments` 同一行 | 同步阶段 `assignments`（与作业同一次读取） | 镜像 | 同上 | PR 4（现在：`lms_kept_assignments`，只存已导入的） |
| 作业与 Semestra 对象的对应、三方合并的快照、冲突、忽略 | Semestra | `lms_imported_refs`（不存平台内容） | 导入、绑定、同步阶段 `assignments`、用户回答 | 镜像 | — | PR 4 |
| 课程总成绩 | 平台的选课记录 | `lms_course_links` 的总分与等级 | 同步阶段 `assignments` | 镜像 | 同作业 | PR 4（现在实时读） |
| 公告（标题、正文、作者、时间、附件） | 平台公告，回看 180 天 | `lms_announcements` | 同步阶段 `announcements` | 镜像 | 排这门课的 `announcements` 阶段 | 现状 |
| 课程资料（文件、页面、syllabus、单元里的链接）的对应与状态 | 平台文件区、页面、syllabus、单元 | `lms_materials` | 同步阶段 `files` | 镜像 | 排这门课的 `files` 阶段 | 现状；syllabus 作为一份页面资料进课程文件：PR 4 |
| 课程资料的内容（含页面正文与 syllabus） | 平台文件与页面 | 在线读取：M07 的文档文本（建索引时从平台读一次）；保存在 Semestra：再加 M07 的本地副本 | M07 管线；`files.store_synced_copies` | M07（检索、阅读读它的文本；打开原件时有副本读副本，否则经内容源读平台） | 同步发现版本变了就重新处理 | 现状 |
| 日历事件 | 平台日历（`type=event`） | `lms_calendar_events` | 同步阶段 `calendar` | 镜像 | 排这门课的 `calendar` 阶段 | 现状 |

只实时读、不存的（读的时候从平台读，`refresh=true` 绕过内存缓存）：

| 数据 | 为什么不存 | 落地 |
|---|---|---|
| 单元与条目的结构（Canvas 标签页浏览、`lms.course.outline`） | 是平台上的目录，浏览时要和平台一致；里面的文件、页面、链接已作为资料进了课程文件 | 现状 |
| 不在课程文件里的页面（资料同步关着、还没同步到）的正文与页面列表 | 在课程文件里的页面由 M07 保存文本；其余是临时浏览 | 现状 |
| 课程导航（Canvas 标签页的栏目） | 是平台课程页的原样目录，Canvas 标签页按它显示；同步判断区域是否关闭时读的那一次，结果记进 `area_reads` | 现状 |
| 讨论与公告的回复 | 是对话，跟着平台随时变，只在阅读时看 | 现状 |
| 练习测验（不对应作业的测验） | 只有题数、时限这类说明，作答必须在平台上；对应作业的测验随作业存 | 现状 |
| 文件区浏览（Canvas 标签页的“文件”，含没同步进来的） | 是平台文件区的原样视图（Canvas 标签页定位为平台的原样浏览）；同步进来的那部分在课程文件里 | 现状 |

与 PR 计划的不同（计划写“只有单元浏览、页面正文、讨论实时读”“按版本存的页面正文改存进镜像”）：页面正文不另存一份镜像，在课程文件里的页面就是 M07 的文档，M07 已保存它的文本，再存一份就是一份事实存两处；原来 `lms_cache` 按版本存的页面正文随数据库层一起删除（PR 4）。上表多出的几类各写了理由。

规则：
- **镜像优先**：存进镜像的数据，读取接口读镜像，不再“先问平台、问不到再用保存的”。镜像替不了平台的只有下面三种，这时实时读平台、不存：这门课关着同步（`sync_enabled=false`，镜像不再更新，§4.4）或还没读过这个区域（`area_reads` 里没有它）；单项在镜像里没有（上次同步之后才发布的作业，从单元或页面的链接打开）；调用方要求 `refresh=true`。两种来源进同一个组装函数，回应里写明来源 `source`（`mirror` / `live`）和镜像的保存时间 `as_of`（课程的 `area_reads.<区域>.read_at`；留给对象的行是它的 `seen_at`），界面、Sem、MCP 都据此说明内容有多新。只有实时读也说没有（`lms.not_found`）才算平台上没有这一项。
- **刷新**：界面上的“刷新”对来源是镜像的数据是给这门课排一次指定阶段的同步（`sync.queue(course, stages=…)`），同步结束后照常从镜像读；对实时读的数据（含按“镜像优先”实时读到的作业：同步跳过关着同步的课程）是带 `refresh=true` 再读一次。只开放 HTTP 的同步请求之外，Sem、MCP 与个人令牌用读取接口的 `refresh=true` 拿平台现在的样子（实时读，不写镜像：读取不写库）。
- **读取不写库**：GET 不写任何表。提交后完成待办（§4.5）在同步的 `assignments` 阶段里做（PR 4；现在是读取作业列表后的单独事务）。
- **没同步过的课程**：作业按“镜像优先”实时读；公告不实时读（§4.7），镜像还空时返回空列表与 `not_read`（`waiting`/`ended`/`paused`），界面显示“还没读过”而不是“没有公告”。
- **新的数据类**：先在表 1 加一行，写清楚存不存；存的就加镜像表、同步阶段和导出适配器。

### 3.2 存储表
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
  total_score?, total_grade?,        # 课程总成绩（PR 4）
  sync_enabled (default true), synced_at?, watched_at?,  # watched_at：公告阶段上次读这门课的时间
  area_reads {区域: {result, at, reason?, read_at?, whole_at?}},    # 每个区域上次读取的结果、unavailable 的原因、最后一次读回来与读全的时间（read_at：whole/partial 时更新，whole_at：whole 时更新，否则沿用；“暂时无法同步”里公告行的 {时间}）（表 3c 的输入；取代 sync_errors 与资料的 materials_settled_at 之外的“读全了”判断）
  sync_errors {阶段: 错误码}, materials_settled_at?,
  created_at, updated_at
  UNIQUE(program_id, connection_id, external_course_id)

lms_assignments                      # 平台作业、本人的提交与反馈，只存事实（PR 4，合并 lms_kept_assignments 与 lms_imported_refs.snapshot）
  id, user_id,
  link_id? → lms_course_links (CASCADE),     # 镜像行：关联课程在平台上的作业，随同步变化
  held_for_kind? ('assessment'|'task'), held_for_id?,   # 留给对象的行：对象已不再对应平台作业，这份内容解释它的成绩（随对象删除）
  course_id → academics_courses (CASCADE), provider, external_id,
  assignment,                        # 作业的事实：provider 交出的 `Assignment`（说明已清洗；不含列表里附带的 `submission` 摘要，提交只看下一列）
  submission?,                       # 我的提交与老师反馈：`SubmissionDetail`（文件只存名称与 id，不存下载地址；评语附件只存名称与平台地址）；为空 = 还没读到
  quiz?,                             # 作业对应测验时测验的事实 `QuizFacts`（题数、时限、可答次数）
  seen_at?                           # 留给对象的行：成为这种行之前最后一次读到它的时间（取自课程的 area_reads.assignments.read_at）；镜像行一般为空：保存时间就是课程的 area_reads.assignments.read_at（每轮本来就写），行本身只在事实变化时才写，平台没变时零写入。迁移或旧备份读进来的镜像行例外，存的是迁移前最后一次读到的时间：同步读全列表之前（那时课程还没有 read_at）解绑时，留给对象的行用它作保存时间
  UNIQUE(link_id, external_id) WHERE link_id 非空；UNIQUE(held_for_kind, held_for_id) WHERE held_for_id 非空
  CHECK(link_id 与 held_for_id 恰好一个非空)

lms_imported_refs                    # 平台上的作业与它在 Semestra 里的对象（同步的依据），只放作业
  id, user_id, link_id, external_id,
  target_kind? ('assessment'|'task'), target_id?, imported_at?,   # 都为空 = 用户忽略了的作业（表 4b；“新作业”是派生值，表 3e）
  snapshot,                          # 三方合并的快照：上次应用的平台值（标题、截止、权重、成绩），不是平台内容的副本
  conflicts {字段: {value, raw}}, removed_at?, dismissed_at?, submitted_at?
  UNIQUE(link_id, external_id)   # 一个作业只对应一个 Semestra 对象

lms_materials                        # 课程资料与它在课程文件里的项（§4.6、表 4a）；项对应哪份资料只记在 item_id（PR 6）
  id, user_id, link_id, kind ('file'|'page'|'link'), external_id,
  item_id?, title?, version?,        # version 只给没有跟随项的资料（list、dismissed 的页面），跟随中的版本在项的 source_version（§4.6，PR 6）
  name?, path?, placed_folder_id?,
  state ('synced'|'list'|'dismissed'|'absent'), state_at?, quiet,
  links [[kind, id]],
  imported_at?, change? ('added'|'duplicate'|'updated'|'gone'|'handed_over'), changed_at?
  UNIQUE(link_id, kind, external_id)

lms_announcements                    # 课程公告（§4.7）
  id, user_id, link_id → lms_course_links (CASCADE), external_id,
  title, html?, author?, web_url?, posted_at?, updated_at?,
  attachments [{external_id, name, mime_type?, size_bytes?}],
  read_at?                           # 在 Semestra 里的已读时间；空 = 未读
  UNIQUE(link_id, external_id), INDEX(user_id, read_at)

lms_calendar_events                  # 平台日历事件
  id, user_id, link_id → lms_course_links (CASCADE), external_id,
  title, html?, location?, web_url?, start_at, end_at?, all_day, all_day_date?
  UNIQUE(link_id, external_id)

lms_item_checks                      # 单独读取一项的最近一次结果（表 3c 的输入；取代 lms_materials.checked_at）
  id, user_id, link_id → lms_course_links (CASCADE), kind, external_id,
  result ('present'|'gone'|'unavailable'), reason?,   # unavailable 的原因（错误码），如 lms.area_hidden
  at, unavailable_since?             # 第一次连续读到 unavailable 的时间（读到 present 或 gone 时清空）
  UNIQUE(link_id, kind, external_id)

lms_sync_changes                     # 同步写过的字段（面板里可撤销）与新反馈（field = feedback），保留 14 天
  id, user_id, ref_id → lms_imported_refs (CASCADE), field, old?, new?, at, reverted_at?
```
规则：
- 课程关联的 `connection_id` 必须等于课程所属 Program 的绑定连接，否则返回 `lms.program_not_configured`。
- Program 已有关联时更换或删除绑定 → `lms.program_has_links`（params: count）。
- 删除连接：要求该连接没有 Program 绑定。界面提供"同时解除所有绑定与关联"选项，选择后在同一事务中解除；已导入的考核、待办、文件保留。
- 年课（跨多个学期的一门课程）只有一个关联，这与 M02 的课程模型一致。
- **`lms_assignments` 的两种行**（PR 4）：
  - **镜像行**（`link_id` 非空）只随平台变化：同步按 (`link_id`, `external_id`) 写入；表 3c 判为已离开时删除，除非它对应着一个对象且用户还没回答删除项（表 4b “平台上已删除”，这时留到用户回答）。考核或待办被删除不影响镜像行。
  - **留给对象的行**（`held_for_*` 非空）属于一个考核或待办，不再更新，随对象删除（订阅 `grading.assessment.deleting`、`tasks.item.deleted`）。对象与平台作业的对应结束时（表 4b 转到“无记录”且对象留下：用户解绑、取消关联、删除项回答“保留”），把那一刻的镜像行复制成留给这个对象的行；取消关联时，`lms.course.unlinking`（与删除关联同一事务、在删除之前）先为每个已导入的对象复制出留给它的行，镜像行再随关联级联删除；留给对象的行没有 `link_id`，不受影响。
  - 一个对象最多一行留给它的内容；它再次导入或绑定（又对应上平台作业）时，删掉留给它的那行，改读镜像行。取消关联后又关联回同一门平台课程时，同步新建镜像行，旧的留给对象的行在对象重新绑定前继续给出它的作业内容。
  - 读取一个对象的作业内容：有对应（`lms_imported_refs`）读镜像行，否则读留给它的行，否则没有。`lms.assignment.targets` 列出两种（已导入的与留着内容的）。
  - 迁移与旧备份：`lms_kept_assignments` 的每一行（以及 2.0 以来备份里的 `feedback` 列表），对象有对应的成为镜像行，没有对应的成为留给对象的行；作业的事实取自这一行的 `details`，没有的（标题、截止、分值）取同一份作业的 `lms_imported_refs.snapshot`。这样得到的镜像只有已导入的作业，所以同时去掉各课程 `area_reads.assignments`：在下一次同步读全作业列表之前没有 `read_at`，按 §3.1 实时读（学期结束超过 30 天、不再自动同步的课程也照样能读到全部作业）。
- 镜像表与 `lms_course_links` 一起导出（§10）。

## 4. 平台回应、派生值与状态
四张表是 LMS 的规则：改规则先改表，评审先对表再看代码；表 2、表 3 的每一行在 provider 契约测试或 `rules.py` 的参数化测试里各有一条（`tests/test_rules_tables.py`），表 4 的每个格子在状态转移函数的测试里各有一条。

### 4.1 表 2：平台回应 → 归一结果
provider 读**单项**的结果只有三种，共享代码只认这三种：
- **`present(数据)`**：在。被锁定（未到开放时间、前置条件没完成）也是 `present`，带 `locked` 与原因。
- **`gone`**：这个用户在平台上确定看不到它了：删除、取消发布、对本人隐藏。
- **`unavailable(原因)`**：不知道：连不上、限流、凭证失效、课程读不到，或者回应可能是因为整个区域关闭而不是这一项不在。什么都不判断。

读一个**区域的列表**的结果只有五种，记进 `area_reads`（表 3c 的输入）：
- **`whole`** 读全了；**`partial`** 被截断（分页超过上限）；**`hidden`** 这个区域对本人关闭（同一轮读到的课程导航里没有它或标为隐藏）；**`unavailable`** 不知道；**`unsupported`** provider 没有这个功能（这个区域不算东西可能出现的地方，表 3c）。

读**课程本身**（同步阶段 `course` 的 `get_course`，每轮第一个读取）的结果是 `present` 或 `unavailable`；`unavailable` 时这一轮到此结束，不判断任何东西（§4.4）。

Canvas 的映射（`providers/canvas/`）。同一个 HTTP 回应只对应一种归一结果；要靠上下文区分的（下面第 5–8 行），由 provider 用同一轮读到的课程导航区分，共享代码看不到 HTTP 状态。标“待确认”的行由 PR 7 用真实 Canvas 的响应记录核对（录制脚本 `python -m devtools record-canvas`，§11）：

| # | 读的是 | Canvas 的回应 | 情况 | 归一结果 | 落地 |
|---|---|---|---|---|---|
| 1 | 课程 | 200 | 课程读得到 | `present` | 现状 |
| 2 | 课程 | 401 不带 `WWW-Authenticate`、403（非限流）、404 | 课程已结束、被移出、课程被删（待确认各是哪一种） | `unavailable`（这一轮结束） | 现状 |
| 3 | 单项 | 200 | 在（含 `locked_for_user: true` 的锁定项；含只能凭链接打开的隐藏文件：列表里没有，直接读得到） | `present`（锁定的带 `locked`） | 现状 |
| 4 | 单项 | 404 | 删除，或对学生取消发布（待确认：页面、作业取消发布是不是 404） | `gone` | 现状 |
| 5 | 单项 | 401 不带 `WWW-Authenticate`、403（非限流），且它的类型所属的区域（见下）这一轮读到了（`whole` 或 `partial`） | 取消发布或对本人隐藏的文件（待确认） | `gone` | 现状 |
| 6 | 单项 | 同第 5 行，但它的类型所属的区域这一轮是 `hidden` | 分不清是这一项不在，还是整个区域被关掉 | `unavailable`（原因 `lms.area_hidden`；PR 7 确认 Canvas 对关闭区域里的单项回什么后再看能否改成 `gone`） | 现状 |
| 6b | 单项 | 同第 5 行，但它的类型所属的区域这一轮是 `unavailable`（导航读不到或开着，原因不明），或这一轮没读 | 区域状态不明，拒绝可能是对整个区域的 | `unavailable`（原因即错误码） | 2026-11-23 代码评审 |
| 7 | 区域列表 | 404、401 不带 `WWW-Authenticate`、403（非限流），且同一轮课程导航里这个区域缺失或隐藏 | 老师关闭了这个区域（Canvas `tab_enabled?`） | `hidden` | 现状（`reads._area_hidden`） |
| 8 | 区域列表 | 同第 7 行，但导航里这个区域开着，或这一轮导航读不到 | 原因不明 | `unavailable` | 现状 |
| 9 | 区域列表 | 200，最后一页 | — | `whole`；带 `hidden_for_user` 的文件与文件夹（以及隐藏文件夹里的文件）不算列出 | 现状 |
| 10 | 区域列表 | 200，分页超过上限 | — | `partial` | 现状 |
| 11 | 任意 | 403 正文含 `Rate Limit Exceeded`，或 `X-Rate-Limit-Remaining` ≤ 0；站点开启时 429 + `Retry-After` | 限流 | `unavailable`（`lms.rate_limited`，带 `retry_after`） | 现状 |
| 12 | 任意 | 401 带 `WWW-Authenticate` | 凭证失效 | `unavailable`（`lms.invalid_credentials`，记到连接上） | 现状 |
| 13 | 任意 | 网络错误、超时、≥ 500 | 连不上 | `unavailable`（`lms.unreachable`） | 现状 |
| 14 | 任意 | 3xx | 地址不是 Canvas API | `unavailable`（`lms.invalid_config`，记到连接上） | 现状 |
| 15 | provider 没有这个功能 | — | — | 区域 `unsupported`，单项不读 | 现状 |
| 16 | 日历列表（`/calendar_events?type=event&all_events=true&context_codes[]=course_<id>`） | 200，最后一页 / 分页超过上限 | — | `whole` / `partial` | 现状 |
| 17 | 日历列表 | 401 不带 `WWW-Authenticate`、403（非限流）、404 | 读不到这门课的日历（待确认 Canvas 对读不到的 `context_codes` 回哪一种） | `unavailable`（日历不在课程导航里，没有 `hidden`；不按第 7、8 行判断；`answers.OFF_NAV`） | 现状 |
| 18 | 日历列表里的一项 | `context_code` 为 `course_section_<id>`（只给某个 Section 的事件），`effective_context_code` 为 `course_<id>` | 分节事件（待确认：学生查询课程 context 时 Canvas 是否返回本人所在 Section 的子事件，以及 `effective_context_code` 是否总有） | 属于 `effective_context_code` 的课程；没有 `effective_context_code` 时丢弃这一项 | 现状 |

- **类型所属的区域**：单项的读取接口属于哪个区域，只看类型，不看它在哪里被列出或链接：文件 → 文件区，文件夹 → 文件区，页面 → 页面，syllabus → syllabus，单元里的外部链接与外部工具 → 单元，作业 → 作业，测验 → 测验，讨论 → 讨论，公告 → 公告，单元 → 单元，日历事件 → 日历（只在列表里读，不单独读）。同一份文件同时出现在隐藏的文件区和开着的单元里时，它的类型所属的区域是文件区。
- `unavailable` 的原因就是错误码（§9），界面与 Sem 按它说明；`lms.forbidden` 与 `lms.not_found` 只在 provider 内部用来区分上面的行，共享代码不再分别处理它们（第 6b 行记下的原因 `lms.forbidden` 只存在 `lms_item_checks`，不出现在界面上）。
- **判断区域是否关闭（第 7、8 行）只有一条规则**：`answers.nav_closed`（导航里缺失或隐藏）。读导航时遇到限流、连不上、凭证失效（第 11–14 行）照常抛出，这一轮这个阶段停下、什么都不改；只有导航本身被拒等其他错误才算“读不到”（第 8 行）。
- 第二个平台的 provider 写自己的这张表，契约测试 `tests/provider_contract.py` 对每个 provider 逐行检查。

### 4.2 表 3：派生值
派生值都是 `rules.py` 里的纯函数，输入是镜像里的事实，输出作为计算字段跟着对象返回；时间相关的用服务器的 `ctx.now`。前端只负责显示，不判断（前端的 `assignmentState` 等规则删除，PR 1）；Sem 与 MCP 的过滤用同一个函数。

**3a 提交状态 `submission_status`**

输入事实与 Canvas 的映射（provider 只交这些，不交 `workflow_state`；待确认的由 PR 7 核对）：

| 事实 | Canvas | 落地 |
|---|---|---|
| 免交 `excused` | `excused` | 现状 |
| 有得分或等级 | 学生能看到的 `score` 或 `grade` 不为空（成绩还没发布时 Canvas 给学生的这两项为空，待确认） | 现状 |
| 等批改 `needs_grading` | `workflow_state` 是 `submitted` 或 `pending_review`，且有 `submitted_at` | 现状（#417） |
| 提交时间 `submitted_at` | `submitted_at` | 现状 |
| 缺交 `missing`、迟交 `late` | `missing`、`late` | 现状 |

按顺序取第一行符合的：

| # | 免交 | 等批改 | 有得分或等级 | 有提交时间 | 结果 |
|---|---|---|---|---|---|
| 1 | 是 | 任意 | 任意 | 任意 | `excused` |
| 2 | 否 | 否 | 是 | 任意 | `graded` |
| 3 | 否 | 是 | 任意 | 任意 | `submitted`（测验有人工批改的题、批改后再次提交：即使带着上一次的得分） |
| 4 | 否 | 否 | 否 | 是 | `submitted`（含已批改但成绩还没发布的） |
| 5 | 否 | 否 | 否 | 否 | `unsubmitted` |

**3b 作业状态 `assignment_state`**（按顺序取第一行）

| # | 提交状态 | 平台标为缺交 | 在平台上提交（提交方式不全是 `on_paper`、`none`、`not_graded`；没写提交方式算在平台上） | 结果 | 显示 | 筛选（Canvas 标签页作业表） |
|---|---|---|---|---|---|---|
| 0 | 不是平台上的作业（练习测验；没有对应作业的待办）；或同步还没读到它的提交（镜像行的 `submission` 为空，已导入与未导入的一样；`lms.assignment.targets` 的 `status` 为空） | — | — | 无（`state` 为空） | 不显示状态 | 只在「全部」 |
| 1 | `graded` | 任意 | 任意 | `graded` | 已评分 | 已出分 |
| 2 | `excused` / `submitted` | 任意 | 任意 | 同提交状态 | 免交 / 已提交 | 只在「全部」 |
| 3 | `unsubmitted` | 是 | 任意 | `missing` | 缺交 | 缺交 |
| 4 | `unsubmitted` | 否 | 否 | `offline` | 无需在线提交 | 3d 为 `upcoming` 时在「待完成」（截止前留着，之后平台无从知道做没做；owner 2026-11-23），否则只在「全部」 |
| 5 | `unsubmitted` | 否 | 是 | `unsubmitted` | 未提交 | 待完成 |

标记（与状态并列显示，不参与筛选）：

| 标记 | 条件 | 显示 |
|---|---|---|
| 缺交 | 平台标了缺交，且状态是 `graded`（缺交按 0 分计入） | “缺交”（标红） |
| 迟交 | 平台标了迟交，且状态是 `graded` 或 `submitted` | “迟交” |

- 用在：作业详情（对话框与侧栏）、待办的提交行、Canvas 标签页的作业表与单元条目、Sem 与 MCP 的作业文本。状态与标记只按本表显示，各处不另写规则。
- 只有平台的缺交标志算缺交：过了截止但平台没标的仍可迟交，是 `unsubmitted`，再由 3d 给出 `overdue`。
- 状态只有一个，用于筛选与计数（一个作业只落在一个筛选里）；缺交与迟交另外作为标记并列显示：缺交按 0 分计入的作业状态是 `graded`，同时显示“缺交”标记，与平台一致。
- 作业状态在作业对象上（作业列表的每项、作业详情、`lms.assignment.targets`、Sem 与 MCP 的作业文本），作业本身的 DTO 不带它。落地：#417（后端）、PR 1（前端只显示）。

**3c 已离开 `presence`**（`rules.presence`，资料、作业、公告、日历事件共用，是判断“平台上已经没有了”的唯一地方）

输入：这一项、它这一轮的单项回应（如果读了）、它最近一次单独读取的结果与时间、它可能出现的区域（provider 支持的那些：资料是文件区、单元、页面与 syllabus；作业是作业列表；公告是公告列表；日历事件是日历列表）各自这一轮的结果。按顺序取第一行符合的：

| # | 条件 | 结果 |
|---|---|---|
| 1 | 课程本身这一轮是 `unavailable`（表 2 第 2、11–14 行） | 不判断（这一轮不会走到判断，§4.4） |
| 2 | 公告的发布时间早于回看期的开始 | 不判断（没问过平台，保留） |
| 3 | 在这一轮的某个区域列表里（含锁定的） | 在 |
| 4 | 这一轮单独读了：`present` | 在 |
| 5 | 这一轮单独读了：`gone` | 已离开 |
| 6 | 这一轮单独读了：`unavailable` | 不判断 |
| 7 | 这一轮没单独读，最近一次单独读取（`lms_item_checks`）在 `CHECK_EVERY`（1 天）内，结果是 `present` | 在（只能单独读到的项：只被页面链接、只凭链接打开的隐藏文件） |
| 8 | 这一轮没单独读，最近一次单独读取在 1 天内，结果是原因为 `lms.area_hidden` 的 `unavailable`（表 2 第 6 行） | 不判断（1 天内不再重读：栏目关着，重读也是一样） |
| 9 | 可能出现的区域都是 `whole` | 已离开 |
| 10 | 可能出现的区域有 `hidden`，其余都是 `whole` | 有状态要改的项这一轮单独读一次，按第 4–6 行；名额见下。作业里只有已导入或已忽略的（表 4b）算；未导入的作业镜像行不单独读，不判断（保留，列在 3c 注“未导入的作业”一行），等列表重新读全再按第 3、9 行 |
| 11 | 其余（有 `partial` 或 `unavailable`） | 不判断 |

- 只看**最近一次**单独读取：最近一次是 `unavailable` 时，更早读到过 `present` 也不算；超过 1 天的结果不用（落到第 9–11 行）。其它原因的 `unavailable`（限流、连不上等，表 2 第 11–14 行）只说明这一次没读到，不适用第 8 行，下一轮照常重读。
- **单独读的名额**：每门课每轮最多单独读 `CHECKS_PER_RUN` = 100 项，第 10 行和资料发现（§4.6：页面链接、只在单元里的文件）共用，按最近一次单独读取的时间从早到晚排（从没读过的最先）；没轮到的这一轮不判断，下一轮先读。因栏目关闭读不到的项 1 天才重读一次（第 8 行），不会每轮占名额。
- **暂时无法同步，用户看得到**：栏目关着时分不清里面的项还在不在（表 2 第 6 行），这些项列在同步面板的“暂时无法同步”里。只有这一种原因会进列表：限流、连不上只是一时没读到，下一轮重读；连接或整门课的问题显示在状态行与连接状态上。列表只由下面的输入决定，不另存状态；平台上又读得到（最近一次单独读取变成 `present` 或 `gone`，或区域结果不再是 `hidden`）时自动消失，按表 3c 与表 4 照常处理。

  | 行 | 入列条件（全部满足） | 显示 | 操作 | 落地 |
  |---|---|---|---|---|
  | 资料（逐项） | 课程的资料同步开着（`lms.materials.sync`）；`lms_materials.state` 是 `synced`，或是带 `quiet` 的 `absent`（用户恢复了、还在等带回）；它的 `lms_item_checks` 最近一次是 `unavailable` 且原因 `lms.area_hidden` | 名称、课程、原因“{平台} 上的“{栏目}”栏目已关闭”（栏目按表 2 的“类型所属的区域”） | `synced` 且没有本地副本：“移除”（红色，经 `ConfirmDialog`）；其余没有操作（有本地副本的照常打开，栏目重新打开后照常跟随；恢复中的等栏目重新打开后带回） | 现状 |
  | 已导入的作业（逐项） | `lms_imported_refs` 有对象；它的 `lms_item_checks` 最近一次是 `unavailable` 且原因 `lms.area_hidden` | 作业名、课程、同一句原因 | 打开作业详情；没有删除操作（对象由用户在成绩册或待办里自己处理） | 现状；作业详情里注明“这是 {时间} 时的内容”随作业镜像（PR 4） |
  | 公告（每门课一行） | 课程的区域结果 `area_reads.announcements.result` 是 `hidden` | “N 条公告”（N = 这门课 `lms_announcements` 的行数）、课程、“{原因}，保持 {时间} 时的样子”，{时间} = `area_reads.announcements.whole_at`（最后一次读全的时间；为空时不写这半句） | 打开这门课的公告页 | 现状；公告页上的说明 PR 4 |
  | 未导入的作业（每门课一行） | 课程的区域结果 `area_reads.assignments.result` 是 `hidden`，且这门课有未导入的镜像行（`lms_assignments` 的镜像行中，没有带对象的 `lms_imported_refs` 的；N > 0） | “N 份未导入的作业”、课程、“{原因}，保持 {时间} 时的样子”，{时间} = `area_reads.assignments.whole_at`（为空时不写这半句） | 打开这门课的“从 {平台} 导入作业”（列出的就是镜像里的作业，可以照常导入） | PR 4 |

  - **移除**只对没有本地副本的资料提供，单项与批量同一条规则：有本地副本的那份可能是用户唯一的一份，不经这里删。单项是 `lms.sync.material.remove`，标题行的“全部移除”（这类资料多于一项时显示，同样经 `ConfirmDialog`）是 `lms.sync.material.remove_all`，按 Program 处理列表里所有这类资料（见 §5）。两者都按表 4a 的“用户在“暂时无法同步”里移除”一列转换，返回最新的 `SyncStatus`。

- “已离开”之后做什么由各自的状态转移表决定（表 4a、4b），本表只回答在不在。
- 用户在这一轮读取期间恢复的资料（`state_at` 晚于这一轮开始读的时间）不在这一轮判断。
- 第 2–11 行的“在这一轮的区域列表里”“单独读”对作业与公告同样适用；它们的单独读取同样记进 `lms_item_checks`。
- 放掉本地副本（§4.6）只对这一轮平台给出了它本身的项做（`material_reads.Found.given`）：在它类型所属区域的列表里（文件在文件区，页面在页面列表），或这一轮单独读到（锁定的除外）。只出现在别的区域列表里的（文件区关闭、只在单元里给出的文件）不算：单独读取可能被拒，副本可能是唯一的一份，留着。
- 日历事件只出现在日历列表里，也不单独读：日历列表的结果只有 `whole`、`partial`、`unavailable`、`unsupported`（不是课程导航里的栏目，没有 `hidden`，表 2 第 16–18 行），所以只会落到第 1、3、9、11 行。

**3d 是否到期 `due_state`**（截止时间、作业状态或单元条目的完成情况、现在；按顺序取第一行）

| # | 条件 | 结果 | 显示 |
|---|---|---|---|
| 1 | 没有截止时间 | `none` | 不显示截止提示 |
| 2 | 作业状态是 `graded`、`excused`、`submitted`；或单元条目没有完成要求、已完成 | `none` | 不显示截止提示 |
| 3 | 截止 > 现在 | `upcoming` | “N 天后截止” |
| 4 | 作业状态是 `offline`（纸质、考试、无需提交） | `past` | “已过截止”（平台无从知道做没做，不标红） |
| 5 | 其余（`unsubmitted`、`missing`，或有完成要求而未完成） | `overdue` | “已逾期”（标红） |

- 作业状态是 `missing` 时不显示截止提示（已有“缺交”）；`due_state` 仍是 `overdue`，供过滤与计数用。
- 作业状态为空（3b 第 0 行，提交还没读到）时 `due_state` 是 `none`：不知道交没交，不说逾期。
- 用在：作业列表的每项、作业详情、单元条目（`lms.module.list`、`lms.module_item.list` 的每个条目）。落地：PR 1（后端算，前端只显示）。

**3e 新作业 `is_new`**（`rules.is_new`；输入是一行镜像与它的 `lms_imported_refs`（可能没有）；同步面板的“新作业”提醒、`lms.assignment.list` 的 `new_ids`、`lms.activity.list` 的新作业都用它）

| # | 条件 | 结果 |
|---|---|---|
| 1 | 已导入或已绑定（`lms_imported_refs` 有对象） | 否 |
| 2 | 用户忽略了它（`lms_imported_refs.dismissed_at`） | 否（面板“已忽略”里列出） |
| 3 | `due_state = upcoming` | 是 |
| 4 | 其余（没有截止、已过截止、已提交、已免交） | 否 |

“新作业”是镜像里作业的派生值，不存状态：截止日推迟后重新变成 `upcoming` 的作业自然又是新作业（PR 4；现在 `lms_imported_refs` 为每个新作业存一行，迁移删掉这些既没有对象也没有忽略的行）。面板里的新作业按镜像行 id（`lms_assignments.id`）列出，“忽略”与“重新提醒”（`lms.sync.dismiss`）也按它：忽略时为它建一行只带 `dismissed_at` 的 `lms_imported_refs`（表 4b），重新提醒时删掉这一行。

**3f 字段跟随 `merge`**（已导入作业的标题、截止、权重、成绩）

平台值 p 的定义：

| 字段 | p |
|---|---|
| 标题 | 作业名，截到 200 字 |
| 截止 | 截止时间换成 Program 时区的日期与时间（到分钟）；没有截止时为空 |
| 权重 | 按作业组权重与分值推算的实际权重；课程没开作业组权重时为空 |
| 成绩（只对考核） | 有得分与分值：得分 / 分值 的百分比；免交：**不跟随**（这个字段这一轮不比较、不写、不问，成绩册的作业列显示“免交”，要不要排除由用户在成绩册里标记）；只有等级没有得分（合格/不合格、字母等级）：**不跟随**；没有得分也没有等级：空 |

按顺序取第一行符合的（快照 s、本地值 mine、该字段的自动更新开关）：

| # | 条件 | 结果 |
|---|---|---|
| 1 | 这个字段不跟随（见上表） | 什么都不做 |
| 2 | 权重或成绩：p 为空而 s 不为空（平台清空了） | 清空本地值与快照，清掉该字段的冲突 |
| 3 | p = mine | 推进快照 |
| 4 | p = s | 平台没改，保留用户的值，清掉该字段旧的冲突 |
| 5 | mine = s（或权重从没设过），自动更新开 | 写入 p，记一条可撤销的变更，推进快照 |
| 6 | mine = s，自动更新关 | 记冲突（`edited: false`）先问 |
| 7 | 其余（两边都改过） | 记冲突（`edited: true`）等用户决定 |

相等一律用 `rules.same`（权重与成绩差 0.005 以内，截止按分钟）。“与平台不同”= 已导入、没有待回答的冲突、本地值与快照不同且 p 不为空（`rules.diverged`）。落地：现状（`tests/test_sync_rules.py`），第 1 行与 p 的定义 PR 4。

### 4.3 表 4：状态转移
有生命周期的对象，状态只经一个函数改，函数按表检查转换。每个格子只有三种写法：**→ 状态**（转换并做括号里的事）、**保持**（合法，不变）、**不会发生**（函数报错）。新增这类对象时在这里加一张表。

**4a 课程资料 `lms_materials.state`**（`materials.enter`，`NEXT` 表；现状）

| 状态 \ 事件 | 平台上出现（这一轮列出或单独读到） | 是列表页 | 已离开（表 3c） | 用户删掉那一项（`files.item.deleted`） | 用户另存这一项（“保存到课程文件”、⋯“保存在 Semestra”） | 用户恢复 | 关闭资料同步后“移除…” | 用户在“暂时无法同步”里移除 |
|---|---|---|---|---|---|---|---|---|
| （无记录） | → `synced`（建项） | → `list` | 不会发生 | 不会发生 | → `synced`（下载建副本） | 不会发生 | 不会发生 | 不会发生 |
| `synced` | 保持（版本变了重新处理，改了名跟着改名） | → `list`（删掉项） | → `absent`（有本地副本：交给用户，记 `handed_over`；在线读取：删掉项，记 `gone`） | → `dismissed` | 保持（这一项要副本） | 不会发生 | → `absent`（删掉项） | 在列表里且没有本地副本：→ `dismissed`（先转换再删掉项，所以 `files.item.deleted` 那一列不再触发；发 `lms.sync.updated`，M07 照常发文件删除事件）；其余：不会发生（拒绝，`lms.sync_nothing_to_resolve`） |
| `list` | → `synced`（列表页又有了正文，建项） | 保持 | → `absent` | 不会发生 | 不会发生 | 不会发生 | 保持 | 不会发生 |
| `dismissed` | 保持（不带回；它链接的东西照常带进来） | 保持 | 保持（面板“已移除”里留着，直到恢复） | 不会发生 | → `synced`（下载建副本） | → `absent`（`quiet`，排一次同步） | 保持 | 不会发生 |
| `absent` | → `synced`（建项；`quiet` 时不算新资料、不通知） | → `list` | 保持（带 `quiet` 的：去掉 `quiet`，记 `gone`） | 不会发生 | → `synced`（下载建副本） | 不会发生 | 保持 | 不会发生 |

进入 `synced` 时记下新的 `item_id` 并清空已应用的平台信息（版本、名称、位置、链接）；进入 `list`/`absent` 时也清空；`dismissed` 保留读到的内容，版本除外（PR 6：版本只记一处，§4.6）。

**4b 作业与 Semestra 对象的对应 `lms_imported_refs`**（`assignment_refs.enter`，`NEXT` 表，与 4a 同样的写法；PR 4 起所有转换只经它，现在分散在 `sync_assignments`、`imports`、`subscribers`；每个格子在它的测试里各有一条；“新作业”不是这里的状态，见 3e）

| 状态 \ 事件 | 导入或绑定 | 用户忽略 | 用户重新提醒 | 已离开（表 3c） | 回到平台 | 用户回答删除项：保留 | 用户回答删除项：删除 | 用户删掉对象、解绑 | 取消关联 |
|---|---|---|---|---|---|---|---|---|---|
| （无记录） | → 已导入 | → 已忽略 | 不会发生 | 保持 | 保持 | 不会发生 | 不会发生 | 不会发生 | 保持 |
| 已忽略（无对象，`dismissed_at`） | → 已导入 | 保持 | → （无记录）（删除这一行） | → （无记录） | 不会发生 | 不会发生 | 不会发生 | 不会发生 | → （无记录） |
| 已导入（有对象） | 不会发生（`lms.assignment_already_imported`） | 不会发生 | 不会发生 | → 平台上已删除（`removed_at`，同步面板问用户） | 保持 | 不会发生 | 不会发生 | → （无记录）（解绑时对象留下，作业内容按 §3.2 留给对象；删掉对象时留给它的内容一起删） | → （无记录）（对象留下，作业内容留给对象） |
| 平台上已删除（有对象，`removed_at`） | 不会发生 | 不会发生 | 不会发生 | 保持 | → 已导入（清掉 `removed_at`） | → （无记录）（对象成为手动添加的；作业内容留给对象） | → （无记录）（对象与留给它的作业内容一起删） | → （无记录）（解绑时对象留下，作业内容留给对象） | → （无记录）（同左） |

- 只有“平台上已删除”和冲突会问用户（同步面板），其余转换不问。
- 导入成待办的作业加入成绩册（`lms.assignment.add_to_gradebook`）不是新的导入：已导入保持，对应的对象换成接管待办的考核（事件 `move`，只在“已导入”时发生）。
- 镜像行随表 3c 删除（§3.2）：已导入且还没回答删除项的作业，镜像行留到用户回答；回答“保留”时先复制成留给对象的行再删。

### 4.4 同步
- **任务**：每门课一个任务 `lms.course.sync`（去重键 `lms.course.sync:<course_id>`，`background` 任务道，`listed=False`，同步有自己的状态行）。按顺序跑注册的阶段（`sync.register_sync_stage(name, run, order, enabled, area)`，`run(ctx, link, b, round)` 经这一轮的 `SyncRound` 读区域与单项）：`course`（0）、`assignments`（20，作业、提交与反馈、跟随、提交后完成待办）、`announcements`（40）、`calendar`（50）、`files`（60）。`sync.queue(course, stages=…)` 可以只跑指定阶段（刷新用，PR 4）。每个阶段先读平台（不拿写锁），再用 `sync.hold` 拿写锁、重读要比较的本地值、写库；每个区域的读取结果写进 `area_reads`。阶段出错只记在这个阶段，其余照跑；只有 `course` 失败才结束这次同步。跑完推进 `synced_at`，发 `lms.course.synced`（`{course_id, program_id, manual, applied, notices, pending, errors}`）与 `lms.sync.updated {program_id}`。
- **什么时候同步**：① 定时任务 `lms.sync_due`（每 5 分钟一轮，每轮最多 20 门课，最久没同步的先排）排上次同步早于账户设置 `lms.sync_every` 的课程；只看 14 天内用过应用、或开着学习平台通知且有推送设备的账户，`sync_enabled`、连接有凭证、学期在进行或未开始或结束不到 30 天的课程（日历还没试过读的课程例外：学期结束超过 30 天的只排 `course` 与 `calendar` 两个阶段，§4.8）。② 打开 Program 时请求一次（不带 `force`）：只排 30 分钟与 `SEMESTRA_LMS_SYNC_MIN_INTERVAL` 中较长者之内没同步过的（日历还没试过读的课程立即排，§4.8），跳过正在同步的。③ 用户手动（`force=true`）：排上 1 分钟内没同步过的，上次失败的不受限制；对单门课的手动同步也读学期已结束的课程。正在运行时再排，结束后再跑一次（`again=True`）。
- **频率**：`lms.sync_every` ∈ 15m / 30m / 1h / 6h（默认）/ 1d；`SEMESTRA_LMS_SYNC_MIN_INTERVAL`（默认 `15m`，托管版 `1h`）是下限。
- **同步写入不经过 M08 导入会话**：自动跟随的字段直接写，留下可撤销的变更记录（`lms_sync_changes`）；冲突、平台上删除的项和新作业在状态行面板里逐项回答（`lms.sync.field.resolve`、`lms.sync.resolve`、`lms.sync.dismiss`、`lms.sync.change.revert` / `.reapply`，资料的 `lms.sync.material.restore` / `.restore_all` / `.remove` / `.remove_all`，都返回最新的 `SyncStatus`；撤销与还原只对同一字段最新、无待回答冲突、本地值仍是上一步留下的变更有效，否则 `lms.sync_change_outdated`）。用户改了已导入对象的这些字段或删除它时发 `lms.sync.updated`。
- **状态**（`sync_status.py`，只读库）：`lms.sync.status` 返回连接错误、频率、课程数、最早的 `synced_at`、是否在同步、待处理（冲突、删除、新作业）、已忽略、最近 14 天的变更（最多 50 条）、与平台不同的字段、资料的变化与已移除的资料、各课程的阶段错误，手动同步的一轮还有 `round {done, total}`。界面只有状态行 `lms.sync` 和它的面板，不弹 toast，不占页面空间。
- **通知**（M18）：`notifications/watch.py` 订阅 `lms.course.synced`：新成绩与变更用 `hidden_only`，新公告只在 `notifications.lms = all` 时发；只改了权重的不单独通知。第一次读一门课（公告的 `watched_at`、资料的 `materials_settled_at` 为空）时只记下现状，不报。
- **`sync_enabled=false`**：这门课不做后台同步、不进日历、不完成待办；镜像里已有的保留但不再更新，作业的读取改为实时读平台（§3.1 “镜像优先”），Canvas 标签页照常可用。

### 4.5 作业、提交与反馈
- **保存**：`assignments` 阶段对整门课只读一次作业列表和一次提交列表（Canvas：`GET /courses/:id/students/submissions?include[]=submission_comments&include[]=rubric_assessment`，不带 `student_ids` 就是本人的），写进 `lms_assignments`；作业是测验时连同测验的事实（题数、时限、可答次数）。没出现在列表里的按表 3c 判断（列表被截断时不判断）。提交的文件只存名称，打开时经代理读平台（`/courses/{id}/lms/assignments/{aid}/submission/files/{fid}/content`）。评语按纯文本显示；评语附件与音视频评语只存名称与平台地址。学生本人写的评论标为 `own`，显示但不算反馈。
- **一轮读什么**：作业列表（区域 `assignments`，表 2 第 7–10 行）、整门课的提交列表、测验列表（只在有作业对应测验时）、课程总成绩（provider 有 `grades` 时，Canvas 是本人的选课记录）。只有作业列表决定在不在（表 3c）。其余三项是同一区域的补充读取：任一项读不到（非 `STOPPING`）时，作业照常写入，这一项的事实沿用上次的（`submission`、`quiz`、`total_*` 不清空），并在阶段错误里记下错误码；`STOPPING` 照常让整个阶段停下、什么都不改。列表被截断（`partial`）时，没列出的作业不判断、不改。
- **跟随**：每次同步用平台的当前内容覆盖，平台上改了或删了评语，本地也跟着改或删。只改有变化的行（逐列比较），平台没变时这一阶段零写入。
- **最近更新**（只对已导入的作业，`lms_imported_refs` 有对象）：有别人写的新评语（按评语 id；没有 id 时按时间与内容），或评分细则第一次有得分时，记一条 `lms_sync_changes`（`field = feedback`，不可撤销），面板里点开作业详情的“提交与反馈”。第一次读到某个作业时已有的反馈不报。
- **提交后完成待办**（账户设置 `lms.complete_submitted`，默认开）：平台上第一次显示已提交（`submitted_at`）的已导入作业记入 `lms_imported_refs.submitted_at`，并完成对应待办（导入成待办的就是它，导入成考核的是考核的待办，M05 `service.complete_open`）。每个作业只做一次；设置关闭时不记，重新打开后补上。在 `assignments` 阶段里做（PR 4）。
- **读取**：作业详情 `lms.assignment.get`、成绩册 `lms.assignment.targets`（每项带作业状态与 `feedback`：有别人写的评语或评分细则得分）、`lms.assignment.list`、Sem 与 MCP 的作业文本都由同一个组装函数得出（PR 4），输入是一行镜像（或留给对象的行），或按 §3.1 “镜像优先”实时读到的同样的事实。回应带 `source` 与 `as_of`，界面据此说明“这是 {时间} 时的内容”（§7.3）。
- **解绑、取消关联、平台上删除后保留**（owner 2026-11-18：评语解释成绩，成绩留下评语也留下）：对象得到一份留给它的作业内容（§3.2），保持最后一次读到的样子，不再更新；平台名与“在 {平台} 中打开”用行里存的 `provider` 与 `web_url`。

### 4.6 课程资料
- **范围**：`files` 阶段把平台上课程的文件（`folders`）、页面（`pages`）、syllabus（作为一份页面，PR 4）和单元里的文件、页面、外部链接与外部工具（`modules`）带进 M07 的课程文件；页面里链接到的文件和页面、只在单元里出现的文件也带进来（逐个读取，占表 3c 的单独读名额；单独读的一天最多查一次，期间按表 3c 第 7、8 行）。只看 provider 的 `features`。设置在 M11 命名空间 `lms.materials`（`sync` 开关与 `store` 保存方式，全局与课程两级，默认开、`online`）。
- **不占存储**：文件与页面建成 M07 的远程文件（`source_kind="lms"`），内容经 M07 的内容源在打开、预览、建索引时从平台读；链接建成 M07 的链接项。锁定的项算“在”（表 3c 第 3 行），在开放之前不建新项。
- **按平台目录放**：每项第一次带进来时按它在平台上的位置（所在单元，否则文件区里的文件夹，否则第一个链接它的页面的位置加上该页面；首页不算）放进由 M07 `SourceFolders` 建立并记住的文件夹，最多三级；不按周归类，不调用模型。只有链接、自身文字不到 160 字的页面是列表页，不保存。
- **用户优先**：每项只放一次，用户移动、改名、删除都不会被同步改回；平台改了名而用户没改的才跟着改名（按 M07 `sources.name_from_source` 得到的名字与 `name` 比较）；平台上换了位置的由 M07 的「整理」提议移回。版本变了的文件重新处理。每次最多新建 100 项。
- **平台上没有了**：按表 3c 判断，按表 4a 转换。新带进来的文件与用户自己的某个文件同名且大小相同时照常带进来，记为 `duplicate`，由用户决定留哪份。
- **保存方式**：`online` 从平台读取 / `local` 保存在 Semestra；每个文件还可以在 ⋯ 菜单里单独选（`files_items.keep_copy`）。改了 `store` 时同一事务里清空这些课程里各文件的 `keep_copy`（以最后一次明确的操作为准）。副本每个文件一个 `files.store_synced_copies` 任务（`background`，去重键按文件），入队前按大小筛掉超过上传上限和剩余配额的。放掉副本只对这一轮平台给出了它本身的项做（表 3c 注）：课程关闭、区域读不到或只在单元里列出时，副本可能是唯一的一份。平台拒绝给出副本（`lms.not_found`/`lms.forbidden`）的文件 1 小时内不再重排副本任务。新建的项每 100 个（`BATCH`）一个事务写入，一轮带进全部；单独读的文件和页面并发读（`reads.files_many`/`pages_many`），仍在名额之内。
- **关闭同步**：已有资料保留，不再更新；“已同步的资料”一行给出数量，“移除…”经确认删除（跳过用户单独保存的）。
- **取消关联**：同一事务里发 `lms.course.unlinking`，有本地副本的交给用户、在线读取的删掉，文件夹保留。
- **新资料**：之后新建的项标 M07 `files_items.unseen`，并作为 `Notice("material", …)` 交给 M18；第一次同步一门课（直到一轮没有因 100 项上限截断为止）不标新、不通知。
- **与 M07 的边界**：只经 `files/sources.py`、`files/source_folders.py` 与内容源，不直接读写 `files_*` 表。
- **跟随关系与版本只记一处**（PR 6，M8；现在：`files_items.source_ref` 与 `lms_materials.item_id` 各记一份对应，`files_items.source_name` 又记一份“来自哪个平台”，`lms_materials.version` 与 `files_items.source_version` 各记一份版本）：

| # | 事实 | 只记在 | 谁写 | 谁读、怎么读 |
|---|---|---|---|---|
| 1 | 课程文件里的一项由哪个来源维护（内容从哪读；随来源更新、删除） | `files_items.source_kind`：注册了内容源的来源名（现在只有 `lms`）；空 = 用户自己的 | M07 `sources.add_remote_file`、`create_link`、`save_bytes_as_file` 建项时写；只有 `detach_from_source` 清空 | M07 按它找内容源、判断“由来源维护”；`content.follows_source` = `source_kind` 非空且是文件（只决定副本的去留，链接没有副本）；前端判断“来自来源”只认 `source_kind`（删除确认、预览读不到的提示），副本相关的界面只认 `follows_source` |
| 2 | 这一项来自哪个平台（显示用的名称） | 不存：`ItemOut.source_name` 由内容源在读取时给出（`register_content_source(kind, opener, names)`，`names(ctx, course_ids)` 按课程返回名称；LMS：课程关联的连接的 provider 名）；`source_kind` 为空时为空 | — | 文件列表、⋯ 菜单、预览提示里的平台名；`files.source_unreachable` 的 `source` 参数 |
| 3 | 这一项对应平台上的哪份资料 | `lms_materials.item_id`（只在 `synced` 时指向跟随中的项；`absent` 时可以指向交给用户的文件，见表 4a）；唯一索引 `(item_id) WHERE state = 'synced'` 保证一个文件只对应一份资料 | `materials.enter`（含另存 `lms/files.py`） | M09 按 `item_id` 反查（唯一，取不到报 `lms.not_found`）：内容源打开字节、删除时记 `dismissed`、另存、整理移回 |
| 4 | 跟随中的项在平台上的当前版本 | `files_items.source_version`（平台版本字符串的哈希）；链接也记（平台给的地址的哈希） | M07 `add_remote_file`、`update_remote_file`、`create_link`、`update_link`（来源把平台的版本字符串交给它们） | M07 判断副本是否过时、处理任务的版本；M09 判断平台上变没变：`sources.source_changed(row, version)` 比较哈希 |
| 5 | 没有跟随项的资料上次读到的平台版本（`list` 的页面、`dismissed` 的页面） | `lms_materials.version` | `sync_files._seen`，只在资料不是 `synced` 时写 | 页面版本没变就不再读一遍正文（`material_reads._page_as_known`；`synced` 的页面比较第 4 行） |

- **两边一致**（第 1 行与第 3 行）：`source_kind = "lms"` 的项与 `synced` 的资料一一对应——每个这样的项恰好是一份 `synced` 资料的 `item_id`，每份 `synced` 资料的 `item_id` 指向一个 `source_kind = "lms"` 的项。表 4a 里进出 `synced` 的每个转换与它对 M07 的写入在同一个事务里：

| 4a 的转换 | M07 的写入 | 先后 |
|---|---|---|
| → `synced`（同步建项） | `add_remote_file` / `create_link`（写 `source_kind="lms"`） | 同一事务，先建项再 `enter` |
| → `synced`（另存：“保存到课程文件”、⋯“保存在 Semestra”） | `save_bytes_as_file(source_kind="lms")` | 同上 |
| `synced` → `list`、→ `absent`（在线读取、`gone`）、关闭同步后“移除…”、“暂时无法同步”里移除（→ `dismissed`） | `purge_items` | 同一事务，先 `enter` 再删项 |
| `synced` → `absent`（有副本、`handed_over`；“读不到的项”里转为我的文件） | `detach_from_source`（清空 `source_kind`） | 同一事务 |
| `synced` → `dismissed`（用户删掉那一项） | 用户的删除走 `purge_items` | 改为同一事务：`purge_items` 在删行前发事务内事件 `files.item.deleting`，M09 订阅它转到 `dismissed`（原来订阅提交后的 `files.item.deleted`，中间有一段资料指向已删除的项，同步里还为“漏掉了事件”留了兜底） |
| 取消关联 | `lms.course.unlinking`（事务内）里先把 `synced` 资料转到 `absent`，再 `purge_items` / `detach_from_source`，随后删掉这门课的资料行 | 同一事务，先 `enter` 再删项（与其它由同步发起的删除相同，不会被当作用户删除） |

  资料只经 `enter` 改状态、项只经上面这些函数建删和交出，所以不变式在每个事务结束时成立；同步不再为“项已不在”兜底（读到这种情况就是错误）。
- `files_items` 不再有 `source_ref` 和 `source_name` 列：`source_ref` 只当“由谁读、是否跟随”的标志用，冒号后的外部 id 从来不解析，和第 3 行是同一个事实；`source_name` 是第 2 行，交出时要记得清空，前端又各自拿它和 `follows_source` 组合判断，现在由来源给出。`source_kind` 原来的 `upload`/`agent` 只说明从哪来，没有任何地方读，一并去掉：上传的和 Sem 存的文件 `source_kind` 为空（Sem 存文件时记的附件 id 也不再写，它从来没被读过）。
- 交出（`detach_from_source`）同时清空文件的 `url`（平台上的地址）：交出后它是用户的普通文件，与平台再无联系。
- `lms_materials.version` 非空只在第 5 行的情况：进入任何状态时清空（`enter`），`synced` 的版本只在它的项上。用户删掉一个页面（→ `dismissed`）后，下一轮把它的正文再读一遍以得到第 5 行的版本（原来沿用跟随时记的版本）。
- 结果：跟随中的项只有第 1、3、4 行，平台上是哪份、版本几何、由谁读，各有一处；改资料模型时不必再同时维护两边（迁移 0063、0066 与对应的 reshape step 就是两份不一致才加的）。
- 用户看得到的变化：
  - 平台上删除后交给用户的文件，以及取消关联时交给用户的文件，不再显示平台名与“在 {平台} 中打开”（原来 `source_kind` 留着 `lms`、`url` 留着平台地址；平台上删除时那个地址已打不开，取消关联时打得开但已不属于这门课的同步）。
  - Sem 存的文件现在算用户自己的文件：「整理」会把放在根目录的这类文件列进去（M07 §整理）；同步新带进来的文件与它同名且大小相同时，资料记为 `duplicate`（“可能与已有文件重复”）而不是 `added`（原来只比较上传的文件）。
- 迁移 0070：`source_ref` 以 `lms:` 开头的项 `source_kind = "lms"`，其余为空；跟随中的链接按它资料上记的版本补上 `source_version`；`synced` 资料的 `version` 清空；修正不一致的旧数据（`synced` 而项已删除的资料 → `dismissed`，与原来的兜底相同；`synced` 而项已交出（`source_kind` 为空）的 → `absent` 并保留 `item_id`；同一个项被多份 `synced` 资料指向时保留最近进入的一份，其余 → `absent`，下一轮同步各自重新建项；`source_kind = "lms"` 却没有 `synced` 资料指向的项按交出处理：链接成为用户自己的链接（清空 `source_kind` 与版本，地址保留，仍能打开），有副本的文件清空 `source_kind` 与 `url`，没有副本的文件（在线读取，已无处可读）连同它的文字、索引与页面图一起删除）；交出文件的 `url` 清空；建唯一索引；删掉 `files_items.source_ref`、`source_name`。备份格式版本不变（files v1、lms v2），0070 之前的备份由同号的 reshape step 做同样的映射（files 与 lms 各一个，`lms/older_backups.py` 里读 `source_ref` 的旧 step 在它之前运行，照旧可用）。
- 接口：`FileItemOut` 去掉 `source_ref`，`source_kind` 只有 `lms`/空，`source_name` 保留（由来源给出）；个人令牌与 MCP 用 `fields=["source_ref"]` 会得到 422。兼容级别见 PR 说明（owner 决定）。
- **出站**：远程文件的预览与下载经后端代理读平台。

### 4.7 公告
- **保存**：`announcements` 阶段读回看期（180 天，常量只有一份 `LOOKBACK`）内的公告，写进 `lms_announcements`，平台上改了的跟着改，已离开的（表 3c）删掉；发布早于回看期的不判断，保留。所有界面、命令面板与 Sem 都读这张表。列表里每条带 `text`（正文的一行纯文本，读取时算出）。
- **已读**：`read_at` 是 Semestra 自己的；打开就标已读。账户设置 `lms.allow_writes` 打开且 provider 支持 `mark_read` 时，本地标记提交后在后台写回平台（尽力而为），同步时平台上已读的也记为已读。
- **未读与通知**：一门课第一次被读时已有公告都记为已读；之后新出现的是未读，发布时间在 2 天内的进 `notices`。`lms.announcement.unread` 按课程给出未读数。存储变化时发 `lms.announcement.updated {course_id, program_id}`。
- **还没读过**：`not_read` = `waiting` / `ended` / `paused`（§3.1 “没同步过的课程”）。
- **附件与链接**：附件已在课程文件里的打开文件预览，否则经文件内容代理在新标签页打开；provider 给的下载地址只在服务器上用。正文里的平台内链输出 `targets`（课程文件、已导入的作业），在读取时计算。课程文件里的图片经文件内容代理加载。
- **显示方式**：账户设置 `lms.display`（`simplified`/`original`），页面上的菜单只改当前页面。

### 4.8 日历事件
- **保存**：`calendar` 阶段（50，provider 有 `calendar` 功能时）读这门课在平台上的**全部**日历事件（`type=event`，不含作业；Canvas 用 `all_events=true`，不按日期截取），写进 `lms_calendar_events`，平台上改了的跟着改。不设时间窗：原来实时读取时任何日期都看得到，镜像也一样，开学前的说明会、跨学期的事件都在。分节事件（只给某个 Section）按表 2 第 18 行归到所属课程。
- **已离开**（表 3c：日历事件只出现在日历列表这一个区域，没有单独读取）：`calendar` 阶段和其他阶段一样经 `SyncRound.area` 读列表（表 2 的映射），每个保存的事件交给 `rules.presence`：日历列表 `whole` 而事件不在里面 → 删除；`partial`、`unavailable` → 不判断，保留。
- **读过的记录**：每轮把日历列表的结果记进 `area_reads.calendar`（阶段内由 `SyncRound.save` 写；阶段因限流、连不上等停下或这一轮没走到时由 `sync_course` 收尾记 `unavailable`）（`{result, at, reason?, read_at?, whole_at?}`，表 1 第 2 行，与其他区域同一个写法 `rules.area_entry`）。`result` 是这一轮的结果（表 3c 的输入）；`read_at` 是最近一次列表真的读回来（`whole` 或 `partial`）的时间，`unavailable` 不改它；`unavailable` 时另记原因 `reason`（错误码）。这一轮在 `course` 阶段就结束（课程读不到，表 2 第 2 行）时，`calendar` 也记一次 `unavailable`；provider 没有 `calendar` 功能时记 `unsupported`。
- **变化**：这一轮有新增、修改或删除时发 `calendar.changed {program_id}`。
- **读取**：日历源 `lms.events` 只读这张表，不请求平台，平台连不上时照常显示上次读到的。只取 `sync_enabled=true` 的已关联课程；按“与查询区间重叠”筛选（`start_at < 区间结束` 且 `end_at`（没有时用 `start_at`）在区间开始之后），跨周、跨天的事件在两边的视图里都出现。全天事件按平台给的日期放在 Program 时区的整天。
- **日历的三种情况**（`rules.calendar_read`，按顺序取第一行；只看开着同步、provider 有 `calendar` 功能、连接正常（有凭证、没有记下凭证失效或地址错误）的已关联课程：`unsupported` 的不算，连接出了问题的由状态行说明连接，不在这里重复）：

| # | `area_reads.calendar` | 情况 | 界面 |
|---|---|---|---|
| 1 | 有 `read_at` | 读过（之后某轮读不到也算读过，日历显示保存的事件） | 无说明 |
| 2 | 为空；或没有 `read_at`、最近一次是限流或连不上（`reason` 为 `lms.rate_limited`、`lms.unreachable`，表 2 第 11、13 行：只是这一次没读到） | 还没读过 | 计入“{N} 门课程的日历尚未同步” |
| 3 | 有记录、没有 `read_at`，最近一次是其它原因的 `unavailable`（课程读不到、日历读不到等） | 读不到 | 计入“{N} 门课程的日历无法读取”，原因在同步面板这门课的阶段错误里（学期结束超过 30 天、常规同步不再访问的课程也列出，阶段为 `calendar`） |

- **第一次读**（只针对第 2 行“还没读过”的课程；落到第 1 或第 3 行后回到 §4.4 的规则，不再优先）。从没试过的课程按下面排；试过、只因限流或连不上没读到的，学期在范围内的交给 §4.4 的正常同步（它每轮都读日历），学期结束超过 30 天的距上次尝试超过同步频率下限（`SEMESTRA_LMS_SYNC_MIN_INTERVAL`）才再排一次，所以平台一直限流或连不上时不会每 5 分钟重排、也不占每轮的名额：
  - 学期在 §4.4 的范围内（进行中、未开始、结束不到 30 天）的课程：照常整次同步；`lms.sync_due` 把它们排在最前面，打开 Program 时不受 30 分钟门槛限制、立即排。
  - 学期结束超过 30 天的课程：只排 `course` 与 `calendar` 两个阶段（`sync.queue(course, stages=["course", "calendar"])`，本 PR 加上 `stages` 参数），不跑作业、公告、资料，不改成绩、不下载资料；同样由 `lms.sync_due` 优先排、打开 Program 时立即排。
  - 打开 Program 时一次最多排 `PER_TICK`（20）门这样的课程，其余由 `lms.sync_due` 在之后几轮里排，免得升级后第一次打开就一起请求平台、触发限流。
- **界面说明**：`lms.sync.status` 带 `calendar_waiting` 与 `calendar_unreadable`（上表第 2、3 行的课程数）。日历筛选面板里平台那一行在它们大于 0 时各显示一行灰字（上表的文字），同步状态行的面板也列出同样的句子；情况变了自动更新。
- **升级时的过渡**：升级后所有课程都是第 2 行，日历里平台事件先不显示、“还没读过”的说明出现；用户打开 Program 即开始读，每门课读完即显示。不保留实时读取作为后备（一份数据只有一条读取路径）。
- **`sync_enabled=false`**：不出现在日历里；已存的行保留，重新打开同步后照常显示并继续跟随。
- **提醒**：平台日历事件不发提醒（owner 2026-11-22）；提醒只来自课表与待办（M18）。
- **导出**：`lms_calendar_events` 随 LMS 适配器导出与恢复；2.0 起的旧备份里没有这张表，恢复后为空、`area_reads.calendar` 为空，按“还没读过”处理。

## 5. Capabilities
| name | effect | http | 说明 |
|---|---|---|---|
| `lms.provider.list` | read | GET /lms/providers | provider 列表、功能标志、配置字段 schema、是否支持学校页登录（`sign_in`） |
| `lms.connection.sign_in.start` | read | POST /lms/connections:sign-in | 返回要打开的学校登录地址；`expose=("http",)`，仅 `sign_in` 为真的 provider |
| `lms.connection.list` | read | GET /lms/connections | 凭证只返回掩码；`expose=("http",)` |
| `lms.connection.create` | write | POST /lms/connections | 先验证再保存；可传 `credentials` 或 `sign_in`（粘贴的回调地址）；`expose=("http",)` |
| `lms.connection.update` | write | PATCH /lms/connections/{id} | 修改凭证时重新验证；可传 `credentials` 或 `sign_in`；`expose=("http",)` |
| `lms.connection.delete` | destructive | DELETE /lms/connections/{id} | 参数 `detach_all`；`expose=("http",)` |
| `lms.connection.validate` | read | POST /lms/connections:validate | 保存前测试；`expose=("http",)` |
| `lms.program.binding.get` / `.set` / `.clear` | read / write / write | GET/PUT/DELETE /programs/{id}/lms-binding | 规则见第 3 节 |
| `lms.course.list` | read | GET /programs/{id}/lms/courses | 使用该 Program 绑定的连接列出外部课程，标记是否已关联及关联到哪门课程 |
| `lms.course.link.get` | read | GET /courses/{id}/lms-link | |
| `lms.course.link.list` | read | GET /programs/{id}/lms-links | 该 Program 所有课程的关联（`items`），课程页标签判断可用性时一次取全，不按课程逐个请求；`expose=("http",)` |
| `lms.course.link.set` | write | PUT /courses/{id}/lms-link | 参数 external_course_id、sync_enabled；冲突 → `lms.course_already_linked`（params: course_id） |
| `lms.course.link.update` | write | PATCH /courses/{id}/lms-link | 修改 sync_enabled |
| `lms.material.count_left` | read | GET /me/lms/materials/held | 参数 course_id?；资料同步已关闭的已关联课程里仍留在课程文件中的资料数（`courses`/`local`/`online`）；只开放 HTTP |
| `lms.material.remove_left` | write | POST /me/lms/materials:remove | 参数 course_id?；删除上面这些资料（§4.6 关闭同步），返回剩余数量；只开放 HTTP |
| `lms.course.link.delete` | write | DELETE /courses/{id}/lms-link | |
| `lms.course.overview` | read | GET /courses/{id}/lms | 课程信息、导航、default_view、provider、功能标志 |
| `lms.announcement.list` | read | GET /courses/{id}/lms/announcements | 已保存的公告（§4.7），`checked_at` 为空表示还没读过这门课 |
| `lms.announcement.mark_read` | write | POST /courses/{id}/lms/announcements/{id}:read | 本地已读；`allow_writes` 开时也写回平台；只开放 HTTP |
| `lms.announcement.unread` | read | GET /programs/{id}/lms/announcements/unread | 每门课的未读数，可按 `term_id` 筛选；只开放 HTTP |
| `lms.assignment.list` | read | GET /courses/{id}/lms/assignments | 按 §3.1 “镜像优先”（PR 4）：每项的 `imported_as`（`{kind: assessment\|task, id}` 或空）、`state`、`due_state`；`new_ids`（表 3e，按截止排序）；`include_total` 时附带课程总成绩（镜像来源取 `lms_course_links` 的，实时来源一起读）；`source`、`as_of`；`refresh=true` 实时读平台（不存） |
| `lms.assignment.get` | read | GET /courses/{id}/lms/assignments/{assignment_id} | 一份作业的全部（§7.3）：作业、我的提交与老师反馈、测验的题数与限时、它在 Semestra 里是哪项考核和待办（`assessment`、`task`）、说明里的链接在 Semestra 里的去处（`targets`）、`source` 与 `as_of`；镜像行，或 `held_for=<assessment|task>:<id>` 时留给那项考核或待办的行（§3.2，PR 4，回应带 `held`），镜像里没有或 `refresh=true` 时实时读这一份作业与提交（不存）；实时读也没有才是 `lms.not_found`；`quiz:<id>` 先找对应这份测验的作业，找不到才是练习测验，实时读（表 1）；只开放 HTTP |
| `lms.assignment.targets` | read | GET /programs/{id}/lms/assignment-targets | 该 Program 里哪些考核和待办是平台上的作业（已导入的读镜像行，解绑后读留给它的行，§3.2），每项带作业状态与 `feedback`，留给它的行带 `held`（打开时传 `held_for`）；待办行、成绩册行菜单据此给出“作业详情”；只开放 HTTP |
| 提交文件代理 | — | GET /courses/{id}/lms/assignments/{assignment_id}/submission/files/{file_id}/content | `routes.py`，按提交给出的地址流式代理我交的文件 |
| `lms.module.list` / `lms.module_item.list` | read | GET /courses/{id}/lms/modules[/{module_id}/items] | |
| `lms.page.list` / `lms.page.get` | read | GET /courses/{id}/lms/pages[/{ref}] | 返回清洗后的 HTML |
| `lms.quiz.list` | read | GET /courses/{id}/lms/quizzes | |
| `lms.syllabus.get` | read | GET /courses/{id}/lms/syllabus | |
| `lms.file.get` | read | GET /courses/{id}/lms/files/{file_id} | 元数据 |
| 文件内容代理 | — | GET /courses/{id}/lms/files/{file_id}/content | `routes.py`，流式代理，用于预览和下载；课程文件里有这份文件的当前版本副本时直接从副本读（`check` 也不再问平台）。文件预览（`lms.file.preview`）对课程文件已经解析过的文件直接用 M07 的页面文本（M07 `sources.current_copy`/`document_pages`），其余照旧从平台下载解析 |
| `lms.file.save_to_course` | write | POST /courses/{id}/lms/files/{file_id}:save | 调用 M07 `save_bytes_as_file`，`source_kind='lms'`，资料行记 `item_id`（§4.6） |
| `lms.course.import` | write | POST /programs/{id}/lms/imports:courses | 选中的外部课程（可选目标学期）→ M08 session（course items，带关联信息），返回 session id |
| `lms.assignment.import` | write | POST /courses/{id}/lms/imports:assignments | 选中的作业 → M08 session：有分值的成为考核（assignment group → 课程已有分类或新分类，规则见 M08 的分类映射；权重按 group weight 推算，无法推算时留空），没有分值的成为待办 ；session 留给审核，由用户（或 Agent 经 `imports.session.commit`）提交 |
| `lms.assignment.add_to_gradebook` | write | POST /courses/{id}/lms/imports:gradebook | 已导入为待办的作业 → 考核（同一流程）；M05 让新考核接管同来源的待办，导入记录改指向考核 |
| `lms.syllabus.import` | write | POST /courses/{id}/lms/imports:syllabus | syllabus HTML → M08 文本抽取 session |
| `lms.sync.status` | read | GET /programs/{id}/lms/sync | 后台同步的状态（§4.4）；只开放 HTTP |
| `lms.sync.request` | write | POST /programs/{id}/lms/sync | `{course_id?, force, stages?}` 排同步任务，返回 `queued`；`stages`（如 `["assignments"]`）只排这门课的这些阶段（要带 `course_id`，`course` 阶段总在其中；§4.4），是界面上作业与公告的“刷新”；只开放 HTTP |
| `lms.sync.resolve` | write | POST /lms/sync/items/{id}:resolve | 回答平台上删除的项（保留/删除）；不是删除项 → `lms.sync_nothing_to_resolve`（409）；只开放 HTTP |
| `lms.sync.dismiss` | write | POST /programs/{id}/lms/sync:dismiss | `{assignment_ids, dismissed}` 忽略或重新提醒新作业，按镜像行 id（表 3e、4b；PR 4 前是 `item_ids`，即 `lms_imported_refs.id`）；只开放 HTTP |
| `lms.sync.field.resolve` | write | POST /lms/sync/items/{id}/fields/{field}:resolve | 按字段回答：被询问的字段取平台值或保留，与平台不同的字段改回平台的值（§4.4）；都不是 → `lms.sync_nothing_to_resolve`（409）；只开放 HTTP |
| `lms.sync.change.revert` | write | POST /lms/sync/changes/{id}:revert | 撤销同步写入的一个字段；只开放 HTTP |
| `lms.sync.change.reapply` | write | POST /lms/sync/changes/{id}:reapply | 撤销还原，再写回同步的值；只开放 HTTP |
| `lms.sync.material.restore` | write | POST /lms/sync/materials/{id}:restore | 恢复一项已移除的资料（表 4a“用户恢复”），排一次这门课的同步；不是 `dismissed` 或这门课资料同步关着 → `lms.sync_nothing_to_resolve`（409）；发 `lms.sync.updated`；返回最新的 `SyncStatus`；只开放 HTTP |
| `lms.sync.material.restore_all` | write | POST /programs/{id}/lms/sync/materials:restore | Program 里资料同步开着的课程的所有已移除资料一起恢复，每门课排一次同步；发 `lms.sync.updated`；返回最新的 `SyncStatus`；只开放 HTTP |
| `lms.sync.material.remove` | destructive | POST /lms/sync/materials/{id}:remove | 移除“暂时无法同步”里一项没有本地副本的资料（表 3c 注、表 4a“用户在“暂时无法同步”里移除”）：删掉它在课程文件里的项（M07 照常发文件删除事件），转到 `dismissed`；不在列表里（不是因栏目关闭读不到、不是 `synced`、资料同步关着）或有本地副本 → `lms.sync_nothing_to_resolve`（409）；发 `lms.sync.updated`；返回最新的 `SyncStatus`；只开放 HTTP |
| `lms.sync.material.remove_all` | destructive | POST /programs/{id}/lms/sync/materials:remove | 同上，作用于 Program 里列表中所有没有本地副本的资料，一个事务；一项也没有 → `lms.sync_nothing_to_resolve`（409）；发一次 `lms.sync.updated`；返回最新的 `SyncStatus`；只开放 HTTP |
| `lms.course.outline` | read | GET /courses/{id}/lms/outline | Agent 用（第 8 节）：模块与全部条目（ref、锁定原因）、开放的栏目、外部工具、不在模块里的页面；`cursor` 分页 |
| `lms.content.search` | read | GET /courses/{id}/lms/search | Agent 用：搜页面正文、公告、作业与评语、测验、讨论、大纲、文件名和链接；课程文件里有的页面和文件在课程文件里搜（见 §8「一份内容一条路径」） |
| `lms.content.read` | read | GET /courses/{id}/lms/content | Agent 用：按 ref 或 LMS 地址读任意条目的全文（Markdown），`offset` 分段；课程文件里有的页面和文件从课程文件读，带 `item_id` 与每页的 `citations` |
| `lms.activity.list` | read | GET /me/lms/activity | Agent 用：一门课或整个学期的新公告、新成绩、新作业和课程资料的变化 |

- 课程级读取接口要求该课程已关联（否则 `lms.course_not_linked`），并检查 provider 功能标志（否则 `lms.feature_unsupported`）。
- M08 提交时，item 的 `data.lms_ref` 带回外部引用。本模块订阅 `imports.session.committed`，写入 `lms_imported_refs`。导入课程时也在同一个提交里创建 `lms_course_links`（M08 的 course item 带 `data.lms_link`，本模块在 `imports.session.committing` 钩子里写入，保证在同一事务中）。

## 6. 事件与扩展
- 订阅：`academics.course.deleting`（删除关联与导入记录）、`academics.program.deleting`（删除绑定）、`grading.assessment.deleting` / `tasks.task.deleting`（删除对应的导入记录，之后可以再次导入）。
- 发出：`lms.course.synced`、`lms.sync.updated`（§4.4）、`lms.assignments.updated {course_id, program_id}`（可合并；镜像行或留给对象的行有变化时，取代 `lms.kept.updated`，PR 4）、`lms.connection.status_changed`、`lms.course.linked`、`lms.course.unlinked`、`lms.course.imports_recorded`（`{course_id}`，M08 提交钩子记下导入的作业或更新的快照之后，前端据此刷新“平台上的新作业”和作业列表的“已导入为”）。
- 贡献：
  - 日历源 `lms.events`（M04 `calendarSources`）：在日历筛选面板中按连接显示；事件描述默认以纯文本显示，用户可以在源设置中开启"渲染 HTML 描述"（清洗后，开启前确认，与旧版一致）。
  - `academics.termWizardImportSources`：学期向导中的"从 LMS 导入课程"（要求 Program 已绑定连接，否则引导绑定）。
  - `grading.assessmentImportSources`：成绩页中的"从 LMS 导入作业"和"{平台} 课程大纲"（`lms.syllabus.import`，读平台上这门课的大纲，打开 M08 审核；需要 `extraction` 用途的模型，未完成的导入用 `lms/import/keys.ts` 的 `syllabusImportKey` 续接，Canvas 标签大纲页的“读取大纲”是同一个导入；平台上没有大纲时不给开始按钮）。
  - `academics.courseInfo`：已关联课程显示 provider 徽章、外部代码，以及"在 <provider> 中打开"。
  - Card `lms.announcements`（course/term 作用域，m/l 尺寸）：最近公告；term 作用域时汇总本学期所有已关联课程。
  - Page `announcements`「公告」（course/term 作用域，见 §7 实现说明）与命令面板搜索 `searchProviders: lms.announcements`。
  - `tasks.links`（M05）：是平台作业的待办显示“作业详情”（只给数据：`query` 是 `lms.assignment.targets`，`open` 返回打开详情的函数，按钮由 M05 画）；`grading.assessmentColumns`：成绩册的“作业”列（见 M03 §5.1）；manifest `overlays`：作业详情（§7.3）。
- 本模块定义的前端扩展点：`lms.providerUi`（见 2.1）；`lms.linkOpeners`（`{ path(link, { programId, courseId }) }`：平台内容里的链接由谁显示，Canvas Tab 用它接住页面与单元的链接，§7.3）。

## 7. 前端
### 7.1 设置
- **全局设置 → 学习平台 → LMS 连接**（旧 `LmsIntegrationManager`）：`SettingsTable` 两列，与 AI 服务商一致。名称列是平台 logo 小方块（Canvas 用 `simple-icons`）+ 显示名，第二行「平台 · 实例地址 · 账户名」（不显示令牌尾号）；状态列一行：短徽标（正常 / 凭证失效 / 缺少凭证 / 没有权限 / 无法连接 / 平台繁忙 / 地址有误 / 出错，完整原因在 Tooltip）+ 相对检查时间。行尾 `⋯` 菜单：测试连接、编辑、删除。"添加连接"对话框：只有一个平台时直接打开它的表单，多于一个才先选平台（可返回）；Canvas 表单：自托管开启学校登录时先选「学校账号 / API 令牌」（编辑时直接进入连接所用的方式，返回可重选）。令牌路径是一个表单：实例地址、访问令牌 + 获取令牌的 3 步说明（第 1 步链接到 `https://<地址>/profile/settings`）。学校账号路径先显示风险提示（是否使用由用户自行决定，本应用不承担后果；已有学校登录的连接重新登录时不再显示），确认后分 3 步，每步只做一件事：① 填地址，继续时取登录链接（错误显示在这一步）；② 点真实链接打开登录页（请求之后再 `window.open` 会被浏览器拦截），在学校页面完成 SSO/MFA，最后停在 `sso.canvaslms.com/canvas/login?code=…`（手机 App 才拦截这个地址，浏览器里是 404 页面，属正常，文案要说明）；③ 粘贴回调地址、填名称、保存。编辑已有的学校登录时先显示地址和名称，可直接保存，也可“重新登录”进入这 3 步。分步由 `ConfigForm` 通过 `frame(fields, step)` 声明，表单外框仍在 `ConnectionForm`。最后验证并保存。手机上使用抽屉。
- **全局设置 → 学习平台**：命名空间 `lms` 自动生成的表单按语义分成四个分区（manifest 用 `fields.hidden` 各取一部分，owner 2026-11-12）：“后台同步”（`sync_every`，检查频率）；“自动更新”（`follow_title`/`follow_due_at`/`follow_weight`/`follow_score`，分区说明讲清规则，各开关只写字段名）；“待办”（`complete_submitted`）；“平台权限”（`allow_writes`）。
- **Program 设置 → LMS**：选择绑定的连接；已有关联时禁用更换，并说明原因和关联数量。
- **课程设置 → LMS**（旧 `CourseSettingsPanel` 中的 LMS 部分）：已关联时显示一行（provider 图标块、外部代码与名称、学期与连接名、状态 Badge + 相对时间、"在平台中打开"图标按钮、⋯ 菜单："立即同步"（`lms.sync.request` 带 `course_id`、`force`）/ 更换课程… / 解除关联…），下方是"同步这门课"开关（即 `sync_enabled`）；状态 Badge 取 `sync_errors` 的第一个错误，时间是 `synced_at`；关联出错时显示 Alert，令牌/权限类错误给"打开 LMS 连接"，其余给"重试"。未关联时是一个可搜索的 Combobox，选中即关联（只认点击/回车选中，触发器上的键入联想不算），课程代码匹配的排在"建议"组，其余按学期分组，已被其它课程关联的项禁用并注明是哪门课程，底部 Checkbox"包括往期课程"；更换时当前课程禁用，选中后先确认。Program 未绑定连接时显示引导；账户里一个连接都没有时直接引导去添加连接。

### 7.2 导入流程
- 学期向导、学期页和 Program 页的"从 LMS 导入课程"：勾选外部课程（默认只显示当前学期，可切换显示全部），选择目标学期，进入 M08 审核，提交后课程与关联同时创建。
- 成绩页的"从 LMS 导入作业"与 Canvas Tab 的"导入"：作业列表多选 → `lms.assignment.import`；一律打开 M08 审核（2026-11-12 起不再无冲突直接保存，owner 决定）。同步面板里的“导入”走同一个接口，作业组到成绩分类的自动匹配不变。
- 同步的界面（`modules/lms/sync/`，owner 2026-11-12）：只有状态行和它的面板，不弹 toast，也不占页面空间。
  - **状态行**（`statusItems` 的 `lms.sync`，M10 §5.6）：Program 绑定了平台就一直在。连接坏了是 `error`（“重新连接 {平台}”）；有待处理是 `attention`（`BellDot`，强调色，“{平台} · N 项待处理”）；同步中转圈；否则 `idle`（“{平台} · M 分钟前同步”）。点开是面板 `SyncPanel`：各课程的阶段错误，头部（平台、上次同步与频率或“正在同步 N 门课程…”、“立即同步”）固定，下面滚动；连接出错时（2026-11-12）没有 Alert 与“立即同步”：副标题红色显示原因与上次同步时间，右上角是主按钮“重新连接”（打开设置里的 LMS 连接），列表照常可滚动，保留/更新/删除/忽略/还原都只动本地数据所以照常可用，只有读平台的“导入”禁用；“待处理”“最近更新”“已忽略”都按课程分组（色点 + 课程代码），行是 shadcn `Item`。待处理：新作业每门课一行（outline 忽略 / 实心导入）；冲突“旧值 → 新值”（箭头是 `ArrowRight` 图标，新值正文色，`edited` 时加“你改过这一项”）：outline 保留 / 实心更新；平台上已删除：outline 保留 / destructive 删除（确认）。回答后的行 200 ms 高度收起，失败则展开回来。最近更新：可切换的行右侧是常驻的 outline 图标按钮（`Undo2` 还原 / `Redo2` 撤销还原，带 tooltip）；还原过的行变灰、新值删除线、副标题以“已还原 ·”开头。可折叠的“与 {平台} 不同 N”（数字和“待处理”一样直接跟在标题后）（默认折叠，每行“你的：… · {平台}：…”，常驻 outline 图标按钮 `CloudDownload` “改回 {平台} 的值”）。可折叠的“已忽略”（恢复提醒 / 导入）。编辑考核对话框与待办详情里，与平台不同的字段旁边有同一个图标按钮（扩展点 `fieldOrigins`，`components/FieldOrigins.tsx`，M09 贡献 `sync/FollowButton`），tooltip 显示平台的值，点按只把值填进表单，保存才写入（owner 2026-11-12：只要一个垂直居中的按钮，值放 tooltip）。（UI 评审 v3，owner 2026-11-12 批准。）
  - **打开时同步**（`SyncOnOpen`，manifest `overlays`）：打开绑定了平台的 Program 时请求一次同步（没绑定的不发请求）。同步的结果只体现在状态行上，不弹 toast（owner 2026-11-12：有状态行就够了）。
  - **命令面板**：“同步学习平台”（绑定了平台时可用），打开面板并强制同步。
- 作业导入可以接着做：同一门课（同一关联）还有等待审核的作业导入（`source_meta.lms.kind == "assignments"`、状态 `ready`）时，再次导入不新建会话，只把还不在其中的作业补进去（作业组对应的分类按 `source_meta.lms.groups` 复用），没有新作业就直接返回那个会话，前端打开它的审核。
- 未设置作业组权重的课程：导入的考核没有权重，带 `import.weight_missing`，所以会打开审核让用户填写（不按分值占比推算：课程总分变化后占比就过时了）。

### 7.3 作业详情（2026-11-20）
应用里显示一份平台作业的唯一地方：任何提到作业的地方点开都是它，就地打开，不换页面，也不必去平台看。提交仍在平台上完成。
- **打开方式**：地址参数 `?assignment=<课程 id>:<作业 id>`（测验也可以写 `quiz:<测验 id>`，由后端的 `lms.assignment.get` 认：对应作业的测验给出那份作业（先在镜像里按 `quiz_id` 找），练习测验给出 `practice: true` 的一份），加 `&view=feedback` 直接到“提交与反馈”，加 `&held=<assessment|task>:<id>` 打开留给那项考核或待办的内容（`held_for`，§3.2；成绩册与待办按 `lms.assignment.targets` 每项的 `held` 带上）。任何页面都认（manifest `overlays` 里的 `AssignmentHost`），所以链接、通知和刷新都能回到它；打开和关闭都替换当前历史记录。代码在 `modules/lms/assignment/`：`target.ts`（`useAssignmentDetails().open/close`）、`queries.ts`、`use-details.ts`、`parts.tsx`、`../content/link-opener.ts`、`AssignmentDialog.tsx`，手机是 `mobile/AssignmentSheet.tsx`（M17）。
- **入口**：Canvas Tab 的作业行、页面与单元里的作业和测验链接；成绩册“作业”列的按钮（有反馈时到“提交与反馈”）；Canvas Tab 的作业行悬停时名称变成强调色并加下划线，表示可以点开；待办行、编辑面板与 ⋯ 菜单的“作业详情”（一直显示的胶囊按钮，不靠悬停）；日历条目详情；公告和作业说明里的作业链接；同步面板“最近更新”与“待处理”的行；学习平台通知（M18）；Sem 的 `lms.content.read` 对作业与测验返回 `app_url`。
- **桌面对话框**：固定高度的两栏。左栏是课程与作业组、标题，下面两个页签：“说明”（清洗后的 HTML，可切换显示方式；锁定原因）和“提交与反馈”（“我的提交”与评分细则同样式的表格：第几次提交、时间与迟交、交的文件/文本/网址；老师评语；评分细则每项的评定与得分）。右栏是状态（未提交 · N 天后截止、已提交、得分与百分比、缺交等，遵守“隐藏成绩”）、“在 {平台} 中提交/打开”、各项事实（截止、分值、班级分布、作业组与权重、开放与关闭、提交方式、次数、测验题数与限时；没有值的不显示）和“在 Semestra 中”（成绩册里的考核与权重、待办及是否完成，点了过去；还没导入时是“加入成绩册和待办”，走导入审核）。只有左栏正文滚动，切页签和数据到达时不跳动。
- **数据**：`lms.assignment.get` 一次读全（PR 4，§3.1 “镜像优先”）。从已读过作业列表的地方打开时先用列表里的内容显示标题、说明与事实，提交与反馈到了再补上。正文顶上的说明只在内容可能不是平台现在的样子时出现，都带保存时间 `as_of`：来源是镜像且最近一次同步这门课的作业失败（`sync_errors.assignments`）、作业区域 `hidden`（3c 注）、留给对象的行（课程已不再关联或作业已不在平台上）。实时读到的不加说明。“刷新”按来源：来源是镜像时排这门课的 `assignments` 阶段（`lms.sync.request` 带 `stages`），同步结束后按事件重新读；来源是实时读（关着同步的课程、镜像里还没有的作业）时同步不会处理它，改为带 `refresh=true` 重新读一次。
- **读不到**：`lms.not_found`（实时读也说平台上没有这份作业）时，对话框左栏显示 `Empty`：“这份作业已不在 {平台} 上”，没有重试；其余错误（连不上、限流等）显示 `Alert` 与“重试”。
- **平台内容里的链接**（`useLmsLinkOpener`，作业详情与公告页共用一份）：别的作业或测验就地打开那一份的详情；课程文件里有的文件开预览，其余文件经文件代理在新标签页打开；公告到课程的公告页（公告页里就地换成那一条）；页面与单元交给 `lms.linkOpeners`（装了 Canvas Tab 时在那里打开）；都接不住的到平台。手机上没有这些页面（`pages: false`）：作业与测验照常就地打开，文件一律经文件代理在新标签页打开，其余到平台，详情不关。
- **加载与出错**：读取中和读不到时对话框保持同样的两栏和大小（左栏骨架或 `Alert` + 重试，右栏保留关闭按钮），内容到了不跳。
- 原来成绩册里的反馈对话框（`FeedbackDialog`、`?feedback=`）和 Canvas Tab 的行内展开都并入这里。

## 8. Agent 集成
Agent 与 MCP 只看到 11 个按任务设计的工具，而不是每个平台接口一个工具（2026-11-08 重新设计，分析见资料库 `2026-11-08-LMS工具重新设计.md`；原则见 Anthropic《Writing effective tools for agents》、OpenAI function calling 最佳实践与 MCP 规范）：

| 用途 | 工具 |
|---|---|
| 读 | `lms.content.search`、`lms.content.read`、`lms.course.outline`、`lms.activity.list`、`lms.assignment.list` |
| 关联 | `lms.course.list`、`lms.course.link.set` |
| 写（走提案确认与 M08 审核） | `lms.file.save_to_course`、`lms.course.import`、`lms.assignment.import`、`lms.syllabus.import` |

其余 capability（逐个平台接口的读取、绑定、关联维护、`lms.assignment.add_to_gradebook`、`lms.sync.*`）只开放 HTTP，供 Canvas Tab 与设置页使用。

- **ref**（`refs.py`）：`<kind>:<id>`，kind 为 page、announcement、assignment、quiz、discussion、file，外加 `syllabus`。由服务端生成，模型原样传回；页面用 slug（可达 600 字符），其它用平台 id。LMS 文本的 Markdown 里平台内链写成 `lms:<ref>`。`lms.content.read` 也接受 LMS 地址（`rewrite_internal_link`）。导入与文件工具的 id 参数同样接受 ref。
- **`lms.area_hidden`**：读整个栏目的列表，按表 2 第 7、8 行得到 `hidden` 时报 `lms.area_hidden`；`unavailable` 时报原因的错误码（课程在平台上被删、学生被移出课程也会被拒）。
- **链接只认同一门课**：`InternalRef` 带链接所在的平台课程（`course`），`Bound.clean(…, course)` 只把指向本课程的链接标成可在应用里打开的条目；`lms.content.read(url=…)` 遇到别的课程的地址报 `lms.other_course`。模块链接在 Markdown 里保持普通地址（模块不是可读的条目）。
- **不带时区的时间**（`since`、`due_after`、`due_before`）按 Program 时区解释。
- **outline / search 只读开放的栏目**：从课程导航得出开放的栏目（`open_areas`），页面、文件、测验、讨论栏目被隐藏时不请求它们的列表（Canvas 会返回 404），在结果的 `skipped` 里注明 `hidden`；模块里的页面仍逐页读取。没有导航功能的平台视为全部开放。
- **搜索**（`search.py`，方案 A：读缓存 + 本地匹配，不建索引）：文档来自模块条目、不在课程文件里的页面正文（每次最多 60 页，`reads.read_many` 并发 4 个请求；进程内缓存（§2.4）：页面列表给出了 `updated_at` 的按它做缓存键、保留 14 天，只能从模块得知的页面 1 小时；进程重启后重新读）、公告、作业、测验、讨论、大纲和按名搜索的文件。按词匹配：英文词匹配词首，中日文按两字切分；先按命中的不同词数排序，再按得分（标题权重 4、短语加分）和日期。单个来源失败只记进 `skipped`，凭证类错误整体失败。
- **`lms.activity.list`**：默认最近 7 天；`assignment` 项只算“新作业”（表 3e 的 `is_new`，时间取截止日）。已导入作业的变化由后台同步处理，用户在同步面板里回答（2026-11-12 起不再有 `change` 项与 `lms.change.import`）。`material` 项（2026-11-19）是同步对课程资料做的事，与同步面板的“最近更新”同源（`lms_materials.change`/`changed_at`）：`change` 为 added / duplicate / updated / gone / handed_over，带资料现在对应的课程文件 `item_id`（gone 时为空）和仍在平台上的资料的 `ref`；它们存在本地，平台连不上时照样列出（单门课时有资料项就把平台错误记进 `skipped`，否则仍报错）。
- **`lms.assignment.list`**：每项带 `ref`；`state`（表 3b）与 `due_state`（表 3d），按 `state` 过滤（PR 4 前 #417 已改用 `state`）、`due_after` / `due_before` 过滤；`include_total` 附带课程总分。回应带 `source` 与 `as_of`（§3.1），给模型的文本写明“as of {时间}”；用户要最新的时模型传 `refresh=true`（实时读，不存）。`lms.assignment.import` 的 `into: gradebook` 即原 `add_to_gradebook`。
- **课程来源**：academics 新增扩展点 `register_course_source(name, linked)`，`academics.course.find` 的结果带 `sources`，本模块对已关联课程贡献 `lms`，让 Sem 知道课程资料还有 LMS 这一处。
- 讨论：provider 契约新增 `discussions`、`discussion`（功能标志 `discussions`），Canvas 的公告也按讨论读取（带回复，最多 100 条）。
- **一份内容一条路径**（2026-11-18，`content.py`）：按「这份内容在不在课程文件里」这一个事实分流。资料同步（§4.6）带进课程文件、状态为 `synced` 且已有可读文本（M07 `active_document_id`）的平台文件和页面，`lms.content.search` 用 M07 的检索（`files.search.search`，限定这些条目）搜正文，命中带 `item_id`、`citation_id`，结果的 `citations` 与 `files.document.search` 相同；`lms.content.read` 直接返回 `files.documents.read_document` 的前几页（`text` 按页拼接、`citations` 每页一条，后续页 `files.document.read`）；`lms.course.outline` 的条目和页面带 `item_id`。不再实时抓这些页面的正文，也不再重新下载解析这些文件。课程文件里没有的（同步关着、用户移除了、还没读完、读不了的类型）才走平台，`note` 写明（“Not in the course files…”或“…not readable there (<doc_status>)…”）。
- **公告与评语读本地**：公告搜索与阅读用 `lms_announcements`（回复不保存，阅读时尽量从平台取，取不到在 `note` 里说明；本地没有的旧公告仍按讨论从平台读）；作业、提交与评语来自 `lms_assignments`（PR 4，与作业详情同一个组装函数，§4.5），评语作为作业文本的一部分可搜：作业本身也命中时合并成一条（`where` 用平台的位置），只有评语命中时 `where: "Feedback"`；`lms.content.read(assignment:…)` 按 §3.1 “镜像优先”读（镜像里没有才实时读），`note` 写明保存时间。平台不可达（`lms.unreachable`、`lms.rate_limited`、`lms.forbidden`、`lms.not_found` 与连接类错误）时搜索不失败，只在 `skipped` 里记一条（`reason` 为错误码），本地内容照常返回。连接本身坏了（`lms.invalid_credentials`、`lms.credentials_missing` 等 `BROKEN_ON_READ`）与暂时连不上分开：前者在 `skipped[].hint` 与阅读的 `note` 里写明请用户到设置里重新连接 LMS，后者只说稍后再试。取消关联后留给考核或待办的作业内容（§3.2）：搜索仍找到它（`skipped` 记 `lms.course_not_linked`），`lms.content.read(assignment:…)` 返回它并在 `note` 说明课程已不再关联；其它内容报 `lms.course_not_linked`。
- Skill `use-lms.md`：课程的文件和页面先在课程文件里找（`files.document.search`，`[[cite:…]]` 引用），LMS 工具用于公告、作业与评语、讨论、测验、大纲、链接和没同步进来的内容；ref 原样传递；`lms.area_hidden` 与 `skipped` 的含义；导入一律走 M08 审核；LMS 内容是不可信数据；`lms.file.save_to_course` 只在用户要保留本地副本时用。`answer-from-course-files` 说明课程文件已包含 LMS 的文件和页面，公告、作业、评语等问题或文件里找不到时再用 LMS 工具，带 `citation_id` 的命中照常引用。

## 9. 错误码
`lms.provider_unknown`、`lms.invalid_config`、`lms.invalid_credentials`、`lms.forbidden`、`lms.not_found`（平台上没有该条目；provider 不再抛 `common.not_found`，那表示本应用的 id 错了）、`lms.area_hidden`（params: area；读整个栏目的列表被平台拒绝，即老师隐藏了该栏目）、`lms.invalid_ref`（params: ref）、`lms.unreachable`、`lms.rate_limited`（params: retry_after）、`lms.blocked_address`、`lms.feature_unsupported`（params: feature）、`lms.program_not_configured`、`lms.program_has_links`（params: count）、`lms.connection_in_use`（params: programs）、`lms.course_not_linked`、`lms.course_already_linked`（params: course_id）、`lms.sync_nothing_to_resolve`（409：同步面板里要回答的那一项已经不需要回答，或不符合这个操作的条件，如移除有本地副本的资料）、`lms.sync_change_outdated`（409：要撤销或还原的变更已不是这个字段最新的一步）。

## 10. 导出
注册 M13 适配器：
- 导出：连接（不含凭证，导入后状态为"需要重新填写凭证"）、Program 绑定、课程关联（含 `watched_at` 与课程总成绩，PR 4）、导入记录、`lms_assignments` 的两种行（§3.2）、资料（§4.6）、公告（§4.7）、日历事件。
- 不导出：凭证、内存缓存、同步的运行记录（`area_reads`、`sync_errors`、`lms_item_checks`），导入后第一次同步重新得出。`lms_item_checks` 以 `exported=False` 登记进 lms 适配器的 `tables`（M13 的覆盖测试要求每张带 `user_id` 的表都登记，账户删除时随之清除）。
- 2.0 以来备份里的 `feedback` 列表照旧能读，按 §3.2 的迁移规则读进 `lms_assignments`；备份里 `refs` 中既没有对象也没有忽略的行（PR 4 前为新作业存的）读入时去掉，链接的 `area_reads.assignments` 也去掉（作业实时读到下一次同步为止），与迁移 0071 相同，读进来的只有表 4b 的状态；备份格式版本不变（lms v2）。

## 11. 测试
- 表 2、表 3 的每一行各一条参数化测试，表 4 的每个格子各一条（`tests/test_rules_tables.py` 与 provider 契约测试）；改表就改测试。
- 真实 Canvas 的回应记录：`python -m devtools record-canvas`（`apps/api/devtools/record_canvas.py`）由 owner 用自己的令牌只读地录下表 2 的各种情况，替换掉姓名、邮箱、用户 id、学校地址与下载链接后存进 `lms/tests/fixtures/canvas/`；PR 7 用它核对表 2 标“待确认”的行，并让假 Canvas 的回应与它一致。
- Provider 契约测试套件 `tests/lms/provider_contract.py`：每个 provider 都必须通过（以后新增 provider 时直接复用）。用一个假 provider 测试模块本身的逻辑，与 Canvas 无关。
- Canvas：用 respx mock Canvas API，覆盖分页 `Link` 头、401、429、重定向到私网地址被拒、base_url 规范化用例（与旧版前端规则一致）。
- 绑定规则：有关联时不能更换绑定；关联必须使用 Program 的绑定连接；关联唯一性。
- 导入：同一作业只对应一个对象（考核或待办）；一律等审核；加入成绩簿保留待办；导入课程同时创建关联且在同一事务中；更新检测。
- 日历：`sync_enabled=false` 的课程不出现；只显示平台日历事件；读同步保存的事件，不请求平台（§4.8）。
- HTML 清洗：去掉 script/style/事件属性；内部链接改写。
- 凭证：任何响应和日志中都不出现明文。

## 12. 验收
- 添加 Canvas 连接并绑定到 Program 后，在学期向导中能一次性导入本学期全部课程，课程自动关联。
- 作业的截止日期只经导入后的待办出现在日历里，不会出现两次。
- 用假 provider 跑通全部模块测试，证明新增 provider 不需要修改模块代码。

## 实现说明（M09 落地时补充）

> 2026-11-12 的后台同步（§4.4）取代了下面关于 `check_updates`、更新审核、`reported`、`lms.refresh_status`、`lms.complete_submitted` 定时任务、`LmsUpdatesBanner`、`NewAssignmentsToast` 与 `lms.term.new_assignments` 的记载，这些接口和组件已删除；这里保留当时的记录。
以下是实现时做出的取舍与对上文的细化，以代码为准。

**后端**
- 导入流程直接用 M08 的 session，所以 M09 在 M08（#32）之后合并。迁移号 `0013`，在 M08 的 `0012` 之后。
- Provider 方法的第一个参数是 `io`（`providers/base.py` 的 `Io`：共享的安全出站客户端、配置、`truncated` 标记），`normalize_config` 额外接收 `settings`（判断是否允许 http 和私网地址）。Canvas 的文件下载只跟随同源或 Canvas 文件 CDN（`.instructure.com`、`.canvas-user-content.com`、`.inscloudgate.net`、`instructure-uploads.s3.amazonaws.com`）的重定向，令牌只发给同源；每一跳都检查目标地址是否公网。分页只跟随同源的 `Link: rel=next`，最多 50 页，超出时返回 `truncated: true`。
- 凭证以 `v1:<Fernet 密文>` 存在 `credentials_encrypted`，响应里只有 `credentials_hint`（掩码）和 `has_credentials`。新增错误码 `lms.credentials_missing`（409）：数据导入后或密钥轮换后凭证无法解密时出现，界面提示重新填写。`lms.invalid_credentials` 用 400 而不是 401，避免触发前端的"会话已过期"对话框。自托管学校登录（`SEMESTRA_LMS_CANVAS_SIGN_IN`）把 refresh token、client_id/secret、过期时间一并加密存下；`service.fresh` 在临近过期或读路径 401 时续期，结果先放进 `app.state.lms` 的内存，提交后再短事务写回。
- 修改连接的配置（例如地址）时必须重新填写凭证，否则返回 `lms.credentials_missing`：已保存的令牌永远不会发往新地址。令牌格式不对时返回 `lms.invalid_credentials`（reason `format`）。
- 课程导入的 session 提交时，如果 Program 已经换绑到别的连接，课程照常创建，但不建立关联（关联必须使用当前绑定的连接）。
- 提交状态归一：`rules.submission_status` 是唯一的判断（excused → graded（有分数或等级，且没有等老师批改）→ submitted（有提交时间，或 `needs_grading`：provider 给出的“交了、等老师批改”，如人工批改的测验、评分后重交）→ unsubmitted）；`Submission`/`SubmissionDetail` 的 `status`、`Assignment` 的 `online`（是否在平台上提交）与 `is_quiz` 都是计算字段（作业状态 `state` 见下一条），所以缓存、同步保存的内容和旧备份不需要迁移就带上它们；`lms.assignment_targets` 的每项同时给出上次同步时的 `status`、`missing`、`late`、`submitted_at`（同步读到之前为空）与由它们算出的 `state`。平台原样的提交 `state` 字段已删除。
- 作业状态、截止提示与标记：见表 3b、3d（`rules.assignment_state`、`rules.due_state`，列表过滤用 `rules.state_of` 直接从缓存里的原始字段算）。
- 定期任务 `lms.refresh_status`（每 6 小时）重新验证连接状态并清理过期缓存：每个连接一个短事务，先问平台、再重新读取该行写状态，期间被删或换了凭证的连接不动；清理缓存单独一个事务。Canvas 公告与日历事件的时间范围都以完整的 UTC 时间传给平台（只传日期时 Canvas 按用户时区的零点算，会漏掉当天零点前的公告）；全天日历事件按平台给的 `all_day_date` 落在 Program 时区的那一天。`set_link` 读外部课程不再写缓存（没有读者）。读缓存在内存 LRU（`app.state.lms`）和表 `lms_cache` 两层，TTL 5 分钟，`refresh=true` 跳过缓存。
- `lms_imported_refs` 多了 `snapshot`（导入时作业的标题、截止时间、分值，以及按作业组推算的实际权重），用于更新检测；`check_updates` 比较的是快照与平台当前值，所以组权重或同组其他作业分值变化也会作为权重更新提示。旧快照没有权重字段时不比较权重。分值变化只在作业组加权的课程里提示（导入不复制分值，未加权课程的分值变化在本地没有可应用的字段）。审核提交时，应用失败的修改项不刷新快照，下次仍会提示。读取平台内容时遇到 `lms.forbidden` 只说明那一项资源没权限，不会把连接标成失效；连接检查（读取本人资料）遇到 403 仍算连接错误。“显示往期课程”时 Canvas 课程列表会额外请求一次 `enrollment_state=completed` 并按 id 去重，因为不带该参数时只返回当前的选课。作业成绩带上 submission 的 `graded_at`。测验列表只含 Classic Quizzes（New Quizzes 是 LTI 作业，暂未识别为测验）；讨论 checkpoint（`type=sub_assignment`）暂不进日历；学期公告卡片仍按课程分别请求，后续可合并成一次多 `context_codes[]` 请求。作业导入或更新审核的 session 未提交期间，课程被取消关联或改关联到另一门平台课程时，提交会整体回滚并返回 `lms.course_not_linked`。
- 导入记录不是订阅 `imports.session.committed` 写的，而是 `register_commit_hook("lms", ...)`：与 M08 提交在同一事务里创建课程关联、写导入记录、刷新快照，提交失败时一起回滚。LMS 侧的对应关系存在 session 的 `source_meta.lms.items`（item id → 外部 id），因为 M08 的 item 数据模型会丢掉未知字段。
- 作业导入按作业组生成 `category` item（`weight_total` 为组权重），考核权重 = 组权重 × 本作业分值占比；课程没开启作业组权重或算不出来时权重为空、置信度为 low，由用户在审核里补。已导入过的作业不再出现在可导入列表里（全部已导入时返回 `import.no_content`）。
- **对 M08 的改动**（M08 规格同步补充）：新 item 类型 `assessment_patch` / `task_patch`（字段级对比，`label` 用于在审核里显示名称），`imports.item.update` 可以传 `type` 在 `assessment` 与 `task` 之间切换（字段按对方的模型转换，切到考核要求有课程；对方没有的字段存进 `held`，切回来时恢复，权重与分类不会丢）。
- 订阅改为 `tasks.item.deleted`（提交后）而不是 `tasks.task.deleting`，因为 M05 发的是这个事件；删除导入记录后同一作业可以再次导入。
- `lms.file.save_to_course` 通过 `importlib` 调 M07 的 `save_bytes_as_file`，M07 还没合并时返回 `lms.feature_unsupported`（feature `save_to_course`）。
- 日历源 `lms.events`：描述只显示纯文本（`meta.note`），"渲染 HTML 描述"开关没有做；`meta.url` 指向平台上的原事件。
- M13 适配器在 `lms/portability.py`（导出连接但不含凭证，导入后状态为 `lms.credentials_missing`；绑定、关联、导入记录按 id 映射；缓存不导出），在文件底部用 M13 的 `register_portability` 注册。lms 与它在 M11 的设置停在 v2：改了导出形状的迁移在 `lms/older_backups.py` 补同号的 reshape step（M13 §11），只对更早的备份执行；step 用到的旧规则（2.2 及以前同步给项起名的方式、资料设置当时的默认值）复制在那里和对应迁移里，不引用会变的代码。

**前端**
- 全局设置"学习平台"组下的"LMS 连接"沿用 AI 服务商分区的列表行样式（`Item` 行 + 行内按钮），没有用表格；手机端仍是对话框，没有做抽屉。删除正在使用的连接时确认框说明会解除多少关联，确认后以 `detach_all=true` 删除。
- Program 设置与课程设置的 LMS 分区都在"学习平台"组（`lms`）。更换关联课程前有确认框：旧关联的导入记录会被清除（之后不再检测这些作业的变化）。课程设置里选择外部课程按平台学期分组（当前学期在前），被其它课程关联的项灰显并写明是哪门课程。
- 新扩展点：`lms.providerUi`（本模块定义，`{ kind, label, logo, description?, summary?, ConfigForm, isComplete }`；`description` 是选择服务商时名称下的一行说明，`summary(config)` 给出连接行上除名称外的标识，Canvas 是实例地址）、`academics.courseInfoRows`（课程信息卡片的额外行：`lms.link` 显示服务商徽章和"在 Canvas 中打开"；`lms.links`「课程链接」列出课程菜单里外部工具（`NavTab.kind = external`，教师隐藏的不列），读 `lms.course.overview` 的 `navigation`，只放行 http(s) 地址，新标签页打开，没有时不显示这一行；两行都声明 `prefetch`（先 link，已关联再 overview），卡片随看板一起开始加载，等各行数据到了（最多 1 秒）再显示，免得晚到的一行把课程描述推下去）（`grading.courseGradesBanners` 随更新提示条在 2026-11-12 删除）。
- M08 的 `openImport` 新增两种请求：`source: 'picker'`（来源自己创建 session 的第一步，例如 LMS 课程/作业选择）和 `source: 'session'`（已有 session 直接进入审核，例如作业变更）。学期向导的来源用 M08 导出的 `wizardImportSource` 包装，所以 LMS 课程也走"向导创建课程 → 提交 session"的流程，关联在提交时创建。向导路径下课程只带课程号和名称，平台上的课程全名（alias）和网址不会写入。
- **前端不写死 Canvas**（UIUX 第三轮）：连接列表每行显示服务商图标与名称（`useProviderName`：provider UI 的 `label`，没有前端贡献时退回后端 `lms.provider.list` 的 `display_name`）；"添加连接"对话框第一步总是选服务商（服务商列表随连接列表预取，加载中是一行 Skeleton，没有可用服务商时显示 Empty；列出后端提供、且前端有 `lms.providerUi` 贡献的服务商，目前只有 Canvas 也照样走这一步），第二步是该服务商贡献的表单，可"返回"重选，标题为"添加 {provider} 连接"；编辑时服务商固定。Program 设置的连接下拉也带服务商图标。通用文案都从服务商名称取："从 {provider} 导入课程"、"{provider} 作业"、"{provider} 课程"、"{provider} 上没有课程/作业"、"在 {provider} 中打开"、变更提示条。学期向导与成绩页"导入"菜单里的名称依赖当前 Program 绑定的服务商，因此 M02 的 `TermWizardImportSource` 和 M03 的 `AssessmentImportSource` 新增可选 `Title` 组件（拿到 `programId`/`courseId` 后渲染）和 `query`（宿主随页面预取 `Title` 要读的数据，打开菜单时名称不再从 LMS 变成 Canvas），M08 的 `ImportPicker` 新增可选 `Title`；没有绑定或加载中时退回"从 LMS 导入课程"。命令面板的命令名称是静态字符串，仍是"从 LMS 导入课程"。
- "从 LMS 导入课程"目前入口是学期向导和学期页的命令面板（命令 `lms.import-courses`），学期页和 Program 页上没有单独的按钮。
- 公告卡片 `lms.announcements`（课程/学期，m/l）只列标题、课程和日期（2026-11-18 起未读的带圆点并加粗，学期作用域先是未读圆点、再是课程色点；与「公告」页读同一个 hook `modules/lms/posts.ts` 的 `useAnnouncements`），点击在「公告」页打开那一条（`?post=<course id>:<公告 id>`）；学期作用域汇总该学期所有已关联课程（暂停同步的课程也显示，同步开关只影响日历和变更检测）。
- **「公告」页**（`modules/lms/pages/AnnouncementsPage.tsx`，2026-11-17，Canvas 数据流入第 4 步）：课程与学期作用域的 Page `announcements`（LMS 核心模块，不是插件）。只在平台支持公告时出现：`lms.course.link.list` 的每条关联带 `features`（平台支持的功能），学期作用域用 `?term_id=` 只取该学期课程的关联（`service.term_links`，学期公告汇总也用它），课程页看本课程的关联、学期页看是否有任一关联支持 `announcements`。左边列表（最新在前，未读粗体 + 圆点，两行正文摘要），右边阅读区；不自动打开第一条，阅读区空时显示“未选择公告”；打开的公告写在地址里（`?post=`），可以直接链接。学期页合并所有已关联课程，每行带课程色点，顶部按课程筛选（`?course=`）。内容区窄（`@page-lg/main` 以下）时只显示列表，打开后阅读区取代列表并带返回按钮。未读标记总是显示（2026-11-18 起已读状态是 Semestra 自己的，§4.7）；页面标签上显示未读数（`PageContribution.unread`，M10 扩展：`query` + `count`，为 0 时不显示，侧边栏不显示）。阅读区与 Canvas Tab 共用 `modules/lms/content/`（`ViewHeader`、显示方式菜单、`LmsHtml`、「在 {provider} 中打开」），显示方式默认取 `lms.display`，页面上选的在页面打开期间保留；正文下是附件区（「附件 N 个」）；链接按 `targets` 在 Semestra 里打开（§4.7）。还没被同步读过时按 `not_read` 显示「公告尚未同步」及原因（§4.7）。打开未读公告时调用 `lms.announcement.mark_read`，成功后本地把课程与学期列表里那一条改成已读（`modules/lms/read-state.ts`，Canvas 标签页共用）。打开公告是一步历史记录（浏览器后退回到列表），课程筛选替换当前记录。命令面板在课程/学期作用域按标题与正文搜索当前范围的公告：`SearchProviderContribution.search` 收到 `queryClient`，经 `ensureQueryData` 读与页面相同的查询（已加载就不再请求），先看关联列表，页面不存在的范围不请求平台；结果打开「公告」页。
- 同一个作业只导入一次，不分考核还是任务：两个导入会话并行，一个已经把作业导成另一种类型时，后提交的整体回滚，报 `lms.assignment_already_imported`（409）。
- 保存连接（新建或改地址/令牌）与验证一样，资料接口 404 统一报 `lms.invalid_config`（`reason=not_canvas`），不会冒出 `common.not_found`。
- 连接坏掉的错误（标记 `error`）包括 `lms.invalid_config`：已保存的地址后来开始重定向或资料接口 404，说明它不再是 Canvas API。
- 两个课程导入会话选了同一门平台课程时，后提交的整体回滚（`lms.course_already_linked`），不会留下一门没关联的重复课程。
- 文件下载跳转到端口非法的地址时报 `lms.blocked_address`。
- 关联课程时先写入关联、再重读 Program 的绑定：查询平台期间绑定被改到别的连接时报 `lms.program_not_configured` 并回滚，不会留下走旧连接的关联。
- 平台返回的链接（`web_url`）只保留 http/https，其他协议（`javascript:` 等）在 DTO 校验时丢弃；日历里打开平台事件时前端也再检查一次。
- **学生视角补充（2026-10-22，Canvas 插件评估的优先项与 11/13/15）**：
  - 新 feature：`submissions`、`folders`、`mark_read`（会改平台上的东西，只在用户允许写操作时用）。新 capability：`lms.submission.get`（`GET .../submissions/self?include[]=submission_comments&include[]=rubric_assessment`：评语、评分标准各项得分、提交次数）、`lms.folder.get`（`/folders/root|:id` 再列子文件夹与文件，`hidden_for_user` 跳过；先按课程路径取一次文件夹，防止读到别的课程的文件夹；`trail` 用 `folders/by_path`）、`lms.file.search`（`/files?search_term=`，只按文件名）、`lms.file.preview`（下载后用 M07 的 `detect`/`parse`，pdf/docx/pptx/xlsx 走隔离进程，按页返回 Markdown，最多 200 页（多读一页判断是否截断），按文件 `updated_at` 缓存，大小上限同上传 `files_max_upload_bytes`，超出报 `lms.file_too_large`）。以上四个开放给 agent/MCP。
  - DTO 补字段：作业 `locked`/`lock_explanation`/`allowed_attempts`/`rubric`；单元 `completed_at`/`prerequisite_module_ids`/`require_sequential_progress`；单元条目 `completion`（`completion_requirement`）/`locked`/`lock_explanation`（取自 `content_details`）/`due_at`/`points`；页面与测验 `lock_explanation`；测验 `time_limit`/`allowed_attempts`/`assignment_id`；submission `attempt`。`lock_explanation` 是 Canvas 的 HTML，转成纯文本。
  - **写操作开关**：账户级设置命名空间 `lms`（`allow_writes`，默认关）。目前唯一的写操作是把公告在平台上标为已读（2026-11-18 起 `lms.announcement.mark_read` 先在本地标记，开关打开时再写回平台，关着时不报错，§4.7）（`PUT /courses/:id/discussion_topics/:id/read`，只开放 HTTP），写之前查设置与 provider 的 `mark_read` feature（`announcements.py`；2026-11-20 删掉了没有调用者的 `service.require_write` 与错误码 `lms.writes_disabled`）；成功后删掉该课程公告列表的缓存（改写缓存会把 5 分钟有效期重新计时），前端自己把那条改成已读。单元的"标记完成"没有做。
  - **成绩进更新审核**：导入快照新增 `score`（平台上的 `points_earned/points_possible`）；`check_updates` 对考核比较平台成绩与快照，平台有成绩且成绩册里还没有相同成绩时给出 `score` 变更（旧值是成绩册当前值：有分数时是分数，只有百分比时是 `{score_percentage}`）；成绩册已经有相同成绩时直接把快照推进到这个平台成绩，之后在成绩册里手动改分不会让同一个平台成绩再次出现。导入时已出的成绩随考核一起带入（审核项 `points_earned`/`points_possible`，2026-11-07 起），快照记下这个成绩，不再作为更新提示；导入为待办的项快照 `score` 记为空，审核里改成考核后仍会提示成绩。应用时 M08 把 `score` 展开为 `points_earned`/`points_possible`。不做静默自动同步。
- **模块评审修复（2026-10-23，评审文档 `2026-10-22-模块评审-LMS.md` 的 17 条）**：
  - 缓存（迁移 0021）：`lms_cache` 加 `scope` 列和 `(connection_id, scope)` 索引（升级时清空旧缓存）；`cache.put` 先写内存，库表在 `ctx.after_commit` 里用 `system_ctx` 单独写入（一个请求的所有条目合并成一次事务），失败只记日志。文件下载 / 预览的接口（`file_content`）提交而不是回滚，好让缓存落库。内存 LRU 改用 `cachetools.LRUCache`，按 JSON 大小计，单条超过上限只放第二层。
  - 新 capability `lms.course.refresh`（`POST /courses/{id}/lms:refresh`，只开放 HTTP）：清掉这门课范围内的缓存（2026-11-23 起日历不再缓存，§4.8），之后的读取照常走缓存。Canvas Tab 的"刷新"只调用它一次（见 M16）。（2026-11-18 起也排一次这门课的同步，保存的公告随之更新。）
  - `sync_link` 只清 `overview` 和 `course` 两个键，不再清整个连接的缓存。
  - 文件预览缓存 7 天（键里已有文件 `updated_at`，文件变了键也变，所以不挂课程范围，"刷新"不清它）；下载用缓存里的文件元数据（Canvas 下载地址带不过期的 verifier）；`file`、`save_to_course`、`preview` 各只取一次文件元数据，Provider 的 `open_file` 直接收 `FileMeta`。
  - Provider 协议：`announcements(course_ids, since)` 一次取多门课（Canvas 每次最多 10 个 `context_codes[]`），每条带 `external_course_id`；`grades` 改为 `grade_totals`，只返回总成绩（名称 "Course total"），作业行由 `lms.grade.list` 复用作业列表；`modules` 带 `include[]=items&include[]=content_details`，单元里直接有 `items`（太多时 Canvas 不带，前端再按单元取）；分页用 httpx 的 `response.links`。
  - 新 capability `lms.term.announcement.list`（`GET /terms/{id}/lms/announcements`，只开放 HTTP，不可信内容）：学期内所有已关联课程的公告，按连接一次请求，按课程分别缓存，最新的在前；返回 `linked_course_ids` 供卡片区分"没有关联"和"没有公告"。某个连接请求失败时跳过它，其余照常返回；一条都拿不到时报那个错误，卡片显示加载失败。`lms.module_item.list` 先看缓存里的单元列表有没有带这个单元的条目。公告卡片学期作用域用它。（2026-11-18 起改为读 `lms_announcements`，不再请求平台，§4.7；`checked` 表示是否至少读过一门课。）
  - `check_updates` 不再在 read capability 的事务里写：推进快照里的 `score` 放到提交后单独写；`preview_apply_updates` 调用时不推进。删除没人读的 `lms_imported_refs.external_updated_at`（M13 适配器不涉及该字段）。
  - 前端查询分两组（`modules/lms/queries.ts`）：`LMS_STATE_QUERIES`（连接、绑定、关联、外部课程、更新检测、概览）和 `LMS_CONTENT_QUERIES`。`invalidateLms(qc, { courseId })` 刷状态组和这门课的内容，`{ all: true }`（改连接）刷全部；SSE 的连接事件刷全部，其余 LMS 事件只刷状态组。立即同步、更新提示条不再调用无参数的 `invalidateQueries()`。
  - **失效按范围缩小**（2026-11-22）：`invalidateLms(qc)` 只在连接变化（凭证、地址、删除）时用，刷全部 LMS 读取。其余变化由事件按范围失效（`queries.ts` 的 `programStateTargets(programId)`、`courseLinkTargets(courseId, programId)`、`courseReadTargets(courseId)`，与 `invalidateTargets(qc, targets)` 共用）：`lms.program.bound` 只刷这个 Program，`lms.course.linked`/`unlinked` 只刷这门课和它所在 Program 的列表，`lms.course.link_updated` 只刷这门课的关联、概览和 Program 的关联列表与同步状态，`lms.course.imports_recorded` 只刷这门课的作业与 `lmsAssignmentTargets`。mutation 有返回值时用 `setQueryData` 直接写（课程关联的修改、解除都返回 `CourseLinkState`），其余交给事件。`realtimeSkipOwn` 只放 `lms.announcement.updated`（`useMarkRead` 自己改缓存）和 `lms.program.bound`（两个绑定入口自己失效）。删除未使用的 `lmsGradeList` 查询。
  - 作业导入的发起共用 `lms/import/assignments.ts`（`startAssignmentImport`、`reviewAssignmentImport`），成绩簿的选择器和 Canvas Tab 都用它。
- 课程作业打通第 3 步（2026-11-07，PR #255，迁移 0035）：① 导入记录一对一：唯一键改为 `(link_id, external_kind, external_id)`（迁移删掉同一作业多余的非考核记录）；提交钩子在作业已导入为待办、这次成为考核时把记录改指向考核，已是考核而这次是待办（并发）时以 `lms.assignment_already_imported` 回滚。② `lms.assignment.import` 不再有 `as_kind`，按分值决定；`ImportStarted` 增加 `committed`、`failed`。③ 新增 `lms.assignment.add_to_gradebook`、`lms.term.new_assignments`，`lms.assignment.list` 增加 `new_ids`。④ 日历源 `lms.events` 在前端贡献 `Mark`（平台 logo）与 `OpenLabel`（"在 Canvas 中打开"）。
- Onboarding 步骤 `lms.connect`（2026-11-09，扩展点 `academics.onboardingSteps`，order 200，在学期向导之前）：服务器提供至少一个平台时出现；列出已有连接（“使用”）和可连接的平台（“连接”，打开设置里同一个 `AddConnectionDialog`），选好后绑定到新 Program，可跳过。首次同步前的配置（owner 2026-11-20）：绑定后不再自动进入下一步，而是在连接下面显示全局的“课程资料”设置（`lms.materials` 的 `NamespaceForm`）和一行“其他选项在设置 → LMS”，由“继续”进入学期向导（导入课程即开始同步）；完成页的 LMS 一行带上资料方式。设置里的 `AddConnectionDialog` 在“验证并保存”成功后进入第二步“已连接 {平台}”，显示同一组设置和“完成”（Onboarding 里传 `setup={false}` 跳过，页面上已有）；课程设置 LMS 分区在未关联时，课程选择下方也显示这门课的资料设置。只问课程资料，因为盘点下来只有它在第一次同步时留下难以收回的结果（大量资料进入课程文件，关闭同步后仍保留）；其余设置第一次同步时不生效或可撤回，保持默认、不进引导。`provides` 在 Program 绑定了连接时为 `lms`，学期向导的“从 Canvas 导入课程”声明 `requires: 'lms'`。
- 绑定手动添加的考核（2026-11-10）：① 导入作业时，同名考核（`import.duplicate_assessment` 带 `assessment_id`，即那一项不是从 LMS 导入的）默认绑定：item 的 `existing_assessment_id` 指向它，仍是 accept，issue 换成 `import.binds_assessment`（让审核打开，前端不当问题显示），不计入权重合计；审核"导入到"一列是下拉（绑定到"X" / 作为新考核加入）。M08 提交时只用 `grading.set_source` 给它设 `source_kind/source_ref`，不写别的字段；提交钩子建 `LmsImportedRef`。② 成绩簿行菜单经扩展点 `grading.assessmentActions` 贡献"绑定 {平台} 作业…"（对话框列出未导入的作业）和"解除与 {平台} 的绑定"（确认），capability `lms.assignment.bind`（`PUT /assessments/{id}/lms-assignment`）与 `lms.assignment.unbind`（`DELETE`，导入的考核也能解除；课程已解除关联时只清来源）。③ 绑定时的快照用考核自己的截止时间与权重、成绩记为未见（`imports.bound_snapshot`），所以第一次检查更新会把 Canvas 不同的截止时间、权重、成绩列为变化供审核，绑定本身不覆盖任何值；标题保留平台的，不提议改名。一个考核只能对应一个同类来源（`grading.source_conflict`）。这些差异同时记进 `reported`（`imports.bound_reported`），M18 的后台检查不会把它们当成平台上的变化推送通知。同一次导入里只有一项能绑定到某个考核（校验时第一个绑定它的 item 之外，其他同名项只给不带 `assessment_id` 的 `import.duplicate_assessment`）。
- 成绩册里的反馈（2026-11-17，2026-11-18 改为读保存的反馈，§4.5）：M09 经 `grading.assessmentColumns` 贡献“反馈”列，列的 `query` 原来是 `lms.feedback.list`（已删），`shownFor`：有考核带反馈时才出现。单元格只在这项考核有评语或评分细则得分时给“查看反馈”按钮；2026-11-20 起按钮打开作业详情的“提交与反馈”（§7.3），不再有单独的反馈对话框。2026-11-20 晚些时候改为“作业”列（owner 选的方案）：列的 `query` 是 `lms.assignment.targets`，有考核对应平台作业时就出现，每个对应作业的行都有按钮，平时打开作业详情，有反馈时换成“查看反馈”；行菜单不再有“查看作业”；“查看反馈”只用强调色区分，不加小圆点（圆点像“未读”，看过也不会消失）。评语与评分标准的渲染在 `modules/lms/components/SubmissionFeedback.tsx`（文案键 `lms_feedback*`、`lms_rubric_*`）。
- 资料跟踪独立成表（2026-11-18，迁移 0056；备份格式仍是 lms v2，2.0.0 的备份里放在 refs 中的资料导入时读成 materials）：课程资料从 `lms_imported_refs` 搬到 `lms_materials`（各状态一列，项是 `item_id`），`lms_imported_refs` 只放作业、去掉 `external_kind`，读它的地方不再按种类过滤。同步与「整理」的类型文件夹规则合到 M07 的 `sorting.folder_for`；本模块只经 M07 的 `sources.py` 与 `sorting.py` 使用文件模块。行为与接口不变。

## 决定记录

> 2026-11-22 起 §3、§4 改写成四张表（数据流、平台回应、派生值、状态转移），规则只写在表里（根因分析见资料库《2026-11-22-LMS问题反复出现的根因.md》）。下面是改写前 §2.4、§3、§4 的原文，保留各项决定的来龙去脉与日期；与上面的表不一致时以表为准。

#### 2.4 读缓存
所有读取接口都经过模块级缓存：先查进程内 LRU（按字节限 64 MB），再查 SQLite `lms_cache`，TTL 5 分钟。缓存键为 `(user_id, connection_id, 方法, 参数)`，每条带范围（`course:<外部课程 id>` 或 `calendar`），凭证更新时清除该连接的全部缓存，`lms.course.refresh` 只清一门课的范围和日历。请求带 `?refresh=true` 时绕过缓存。读取不在请求事务里写库：`lms_cache` 在请求提交后用单独的短事务写入。

### 3. 领域模型
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
  sync_enabled (default true), synced_at?, sync_errors {阶段: 错误码}, watched_at?,  # watched_at：公告阶段上次读这门课的时间
  created_at, updated_at
  UNIQUE(program_id, connection_id, external_course_id)

lms_imported_refs                    # 平台上的作业与它在 Semestra 里的对象（同步的依据），只放作业
  id, user_id, link_id, external_id,
  target_kind? ('assessment'|'task'), target_id?, imported_at?,   # 都为空 = 用户忽略了的作业（表 4b；“新作业”是派生值，表 3e）
  snapshot, conflicts {字段: {value, raw}}, removed_at?, dismissed_at?, submitted_at?
  UNIQUE(link_id, external_id)   # 一个作业只对应一个 Semestra 对象

lms_materials                        # 课程资料（文件、页面、链接）与它在课程文件里的项（§4.2）
  id, user_id, link_id, kind ('file'|'page'|'link'), external_id,
  item_id?,                          # M07 的 files_items.id（不是外键：用户删掉的项要和从没建过的区分开）
  title?, version?, name?,           # 上次从平台应用的标题、内容版本、项名
  path?, placed_folder_id?,          # 在平台上的位置（文件夹名，迁移 0060 起由同步填写）；同步放进的文件夹
  state ('synced'|'list'|'dismissed'|'absent'), state_at?, quiet,  # 见 §4.2「状态」
  links [[kind, id]],                 # 页面链接到的资料（上次单独读取的结果在 lms_item_checks，迁移 0068）
  imported_at?, change? ('added'|'duplicate'|'updated'|'gone'|'handed_over'), changed_at?  # 最近一次平台带来的变化（面板，保留 14 天）
  UNIQUE(link_id, kind, external_id)

lms_kept_assignments                 # 已导入作业保存在 Semestra 里的内容（§4.4）：说明、我的提交、老师反馈；每个考核或待办一行（`assessment_id` 与 `task_id` 恰好一个非空，库里有检查约束）
  id, user_id, assessment_id → grading_assessments (CASCADE, unique),
  course_id → academics_courses (CASCADE), provider, assignment_id（读自哪个平台的哪份作业）,
  web_url?, points?, score?, grade?, attempt?, graded_at?,
  comments [SubmissionComment], rubric [RubricCriterion], rubric_scores [RubricScore]


lms_announcements                    # 课程公告，同步阶段 announcements 写入（§4.3）
  id, user_id, link_id → lms_course_links (CASCADE), external_id,
  title, html?, author?, web_url?, posted_at?, updated_at?,
  attachments [{external_id, name, mime_type?, size_bytes?}],
  read_at?                           # 在 Semestra 里的已读时间；空 = 未读
  UNIQUE(link_id, external_id), INDEX(user_id, read_at)


lms_sync_changes                     # 同步写过的字段（面板里可撤销）与新反馈（field = feedback），保留 14 天
  id, user_id, ref_id → lms_imported_refs (CASCADE), field, old?, new?, at, reverted_at?

lms_cache  key, user_id, connection_id, scope, payload, expires_at
```
规则：
- 课程关联的 `connection_id` 必须等于课程所属 Program 的绑定连接，否则返回 `lms.program_not_configured`。
- Program 已有关联时更换或删除绑定 → `lms.program_has_links`（params: count）。
- 删除连接：要求该连接没有 Program 绑定。界面提供"同时解除所有绑定与关联"选项，选择后在同一事务中解除；已导入的考核、待办、文件保留。
- 年课（跨多个学期的一门课程）只有一个关联，这与 M02 的课程模型一致。

### 4. 同步语义
- 公告由后台同步保存（§4.3）；其余浏览类数据（单元、页面等）实时读取，有缓存。
- 作业由后台同步（§4.1）跟随平台；课程本身（名称、学分等）不跟随，同步只刷新关联的外部元数据（代码、名称、学期、web_url）。
- 日历叠加：`lms.events` 日历源读同步保存的事件（§4.8）。只有平台的日历事件，作业不在这里出现，所以不需要与考核或待办去重。
- 提交后完成待办（`lms/submissions.py`，账户设置 `lms.complete_submitted`，默认开）：每次读取课程作业（Canvas Tab、导入、后台同步）后，在单独的事务里把平台上第一次显示已提交（`submission.submitted_at`）的导入作业记入 `lms_imported_refs.submitted_at`，并完成对应待办：导入成待办的就是该待办，导入成考核的就是考核的待办（M05 `service.complete_open`）。每个作业只做一次，用户之后取消勾选不会再被勾上；设置关闭时什么也不记，重新打开后补上期间提交的。
- `sync_enabled=false`（课程设置的“同步这门课”）：该课程不出现在日历叠加中，也不做后台同步和提交后完成待办；读取接口和 Canvas Tab 仍然可用。

#### 4.1 后台同步（2026-11-12，迁移 0046）
- **任务**：每门课一个任务 `lms.course.sync`（去重键 `lms.course.sync:<course_id>`，`listed=False`：不进状态栏的任务列表，同步有自己的状态行）。按顺序跑注册的阶段（`sync.register_sync_stage(name, run, order, enabled, area)`，`run(ctx, link, b, round)` 经这一轮的 `SyncRound` 读区域与单项）：`course`（0，刷新关联的外部元数据）、`assignments`（20）、`feedback`（30，§4.4）、`announcements`（40）、`files`（60，课程资料，§4.2）。每个阶段先读平台、再在自己的事务里写；出错的阶段把错误码记进 `lms_course_links.sync_errors`，其余阶段照跑；只有第一个阶段失败（读不到课程本身，多半是连接坏了）才结束这次同步。全部跑完后推进 `synced_at`，发 `lms.course.synced`（`{course_id, program_id, manual, applied[{change_id, name, field}], notices[{kind, external_id, title}], pending, errors}`）与 `lms.sync.updated {program_id}`。连接错误照常由 `service.attempt` 记到连接上（替代原来每 6 小时的 `lms.refresh_status`）。
- **什么时候同步**：① 定时任务 `lms.sync_due`（每 5 分钟一轮，每轮最多排 20 门课，最久没同步的先排）排上次同步早于账户设置 `lms.sync_every` 的课程；只看 14 天内用过应用的账户（离开更久但开着学习平台通知、有推送设备的账户照常同步，否则通知收不到），`sync_enabled`、连接有凭证、学期在进行/未开始/结束不到 30 天的课程。② 打开 Program 时前端请求一次（`lms.sync.request`，不带 `force`）：只排 30 分钟与服务器下限（`SEMESTRA_LMS_SYNC_MIN_INTERVAL`）中较长者之内没同步过的。③ 用户手动（状态行面板“立即同步”、命令面板“同步学习平台”、课程设置的“立即同步”，`force=true`）：排上 1 分钟内没同步过的（`COOLDOWN`），上次同步失败的课程不受这个限制。定时任务先用一条 SQL 只挑出有课程超过服务器下限没同步的用户。同步任务跑在 `background` 任务道（M00 §3.7），由专属 worker 执行，不和用户在等的任务抢 worker；同步读平台的结果只进内存缓存（`service.memory_cache()`），不写 `lms_cache`（2026-11-13 后端评审）。
- **频率**：`lms.sync_every` ∈ 15m / 30m / 1h / 6h（默认）/ 1d。环境变量 `SEMESTRA_LMS_SYNC_MIN_INTERVAL`（默认 `15m`）是下限：设置表单经 `register_settings(adapt=…)` 只列出不短于下限的选项，已存的更短值按下限执行。托管版设为 `1h`。
- **作业怎样跟随**（`sync_assignments.py`）：字段为标题、截止、权重（按作业组推算的实际权重）和成绩（只对考核）。对每个字段比较平台值 p、快照 s 与本地值 mine，决定由纯函数 `rules.merge(字段, s, mine, p, 自动更新开关) → Action` 给出（相等一律用 `rules.same`：权重与成绩差 0.005 以内、成绩按百分比，截止按分钟），同步阶段、`different` 列表（`rules.diverged`：结果是 KEEP 或 CONFLICT 且 p 不为空）和 `lms.sync.field.resolve` 都只调用它，`tests/test_sync_rules.py` 按表覆盖全部组合；平台把权重或成绩清空 → CLEAR；p = mine → 推进快照；p = s → 平台没改，保留用户的值；mine = s（或权重从没设过）→ 写入 p（经 `grading.assessment.update` / `tasks.item.update`），记一条 `lms_sync_changes`，推进快照；但用户在账户设置里关掉了这个字段的直接更新（`lms.follow_title` / `follow_due_at` / `follow_weight` / `follow_score`，默认都开，owner 2026-11-12）时，改为记进 `conflicts`（`edited: false`）先问；否则两边都改过 → 记进 `conflicts`（`edited: true`）等用户决定。p = s 时同时清掉这个字段旧的冲突：用户已经把值改成别的或平台改回去了，就不再询问。平台上不见了的已导入项记 `removed_at`（作业列表被截断时不判断）。还没导入、截止在未来的作业建一条没有 target 的记录，作为“新作业”提醒；过了截止、或在平台上消失的未忽略记录直接删掉。`lms.assignment.bind` 绑定手动添加的考核时快照用 `bound_snapshot`（截止、权重、成绩记为未见），所以下一次同步补上考核缺的值、两边都有且不同的作为冲突询问。
- **用户的回答**：按字段回答 `lms.sync.field.resolve`（`{item_id, field, choice}`：被询问的字段 `platform` 取平台值并记一条 `lms_sync_changes`、`mine` 保留自己的值，两者都把快照推进到这个平台值、只清掉这一个字段的冲突；“不同”列表里的字段只能 `platform` 改回；面板每个冲突字段一行）、删除项 `lms.sync.resolve`（`keep`/`delete`）、`lms.sync.dismiss`（忽略或重新提醒新作业）、`lms.sync.change.revert`（撤销一条变更：写回旧值，快照保持平台值，所以下次不会再改回去）。`lms.sync.change.reapply` 撤销还原（再写回新值）。两者都只对同一字段最新的那条、该字段没有待回答的冲突、且本地值仍是上一步留下的值（未还原时是新值，已还原时是旧值）有效（`SyncChange.toggleable`，面板只给这些行按钮）；否则 `lms.sync_change_outdated`（409），免得覆盖用户之后改的值。这些接口都返回最新的 `SyncStatus`。
- **状态**（`sync_status.py`，只读库）：`lms.sync.status` 返回连接错误、频率、课程数、最早的 `synced_at`、是否在同步、待处理（冲突、删除、新作业，按截止排序）、已忽略、最近 14 天的变更（最多 50 条）、与平台不同的字段（`different`）和各课程的阶段错误。用户点「立即同步」后的一轮还返回 `round {done, total}`（`sync.sync_round`：自最早一个未结束的课程同步任务创建以来的所有课程同步任务，有一个是手动的才算；后台自己的同步不给，2026-11-18）。状态行始终显示平台名，状态放在行尾（上次同步时间、`done/total` 与行内进度条、等待处理的数量徽标），原因放在提示里；面板顶部是平台名、状态与「立即同步」「同步设置」两个图标按钮，手动同步时底边是进度条。
- **与平台不同的字段**（2026-11-12，owner 选甲）：已导入、没有待回答冲突的字段里，本地值和快照（上次看到的平台值）不同的就是 `different`（`SyncDifference`：item、字段、本地值、平台值、`target_kind`/`target_id`）；平台值为空的字段（没有截止、还没成绩、没有权重）不算，那是用户自己补的（owner 2026-11-12 确认不列：不分权重的课、先在别处拿到的成绩都很常见，改回会清掉用户的值）。它们不算待处理，状态行不提醒。`lms.sync.field.resolve`（`choice: platform`）把这个字段写回快照里的平台值；选 `mine` 保留的冲突字段之后就列在这里，随时可以改回（之后平台再改它时照常按 `lms.follow_*` 处理），并像同步写入一样记一条 `lms_sync_changes`，所以能在“最近更新”里还原。被还原、仍可撤销还原的字段只在“最近更新”里出现，不再列进 `different`。截止时间按分钟比较（Canvas 默认 23:59:59，Semestra 不存秒）。待办的截止是本地日期与时间（考核是时刻），快照记下这次读平台截止所用的时区（`zone`，导入与每次推进截止时写入）；Program 换时区后，按旧时区读快照判断“用户有没有改过”，所以不算“不同”，下次同步按新时区跟随。同步阶段读完平台后先用 `sync.hold` 拿写锁再读要比较的本地值，用户的回答（解决、忽略、还原、改回）也先 `hold` 再重读，二者不会基于对方提交前的状态互相覆盖（pysqlite 到第一条写才开事务）。平台把权重或成绩清空时快照也推进为空并清掉该字段的冲突。用户改了已导入对象的这些字段或删除它时（`grading.assessment.updated/deleting`、`tasks.item.updated/deleted` 的订阅，`subscribers.py`），发 `lms.sync.updated`（可合并），面板与编辑处的按钮随之刷新。
- **通知**（M18）：`notifications/watch.py` 订阅 `lms.course.synced`：新成绩与变更用 `hidden_only`，新公告只在 `notifications.lms = all` 时发。只改了权重的不单独通知。免打扰时段内的留到时段结束再发（M18 §4.4）。公告“新”指这次保存时第一次见到的（§4.3）；第一次读一门课时只记下现状、不报，发布早于 2 天前的不报。
- **偏离计划**：同步写入不经过 M08 导入会话（原计划生成更新 session 再审核）。自动跟随的字段直接写，留下可撤销的变更记录；需要用户决定的在状态行面板里逐项回答，不打开导入审核。M08 的 `assessment_patch`/`task_patch` 随之删除。

#### 4.4 已导入作业保存在 Semestra 里（2026-11-18，迁移 0059；2026-11-20 加上说明与提交，迁移 0067）
- **保存**：同步阶段 `kept`（`sync_kept.py`，order 30，provider 有 `assignments` 与 `submissions` 时）把每个已导入或已绑定的考核在平台上的老师反馈存进 `lms_kept_assignments`（2026-11-20 由 `lms_feedback` 改名，事件是 `lms.kept.updated`；备份里的键仍是 `feedback`，格式不变）：评语、评分细则本身（作业的 `rubric`，含各项名称、分值与等级，离线也能完整显示）和每项得分，以及平台上的得分、提交次数、评分时间、作业地址与分值。评语是平台给的纯文本，按文本显示，不渲染 HTML。评语的附件和录音录像评语只存名称与平台上的地址（`SubmissionComment.attachments`，`media` 区分音视频），对话框里显示成链接，到平台上打开。学生本人在自己提交下写的评论标为 `own`（Canvas：评论的 `author_id` 等于提交的 `user_id`），对话框照常显示以保留来回的上下文，但不算反馈：不让成绩册的作业按钮变成反馈，也不算新评语。2026-11-20 起同一行还保存作业本身（`details`：说明的 HTML、截止与开放关闭时间、提交方式、可提交次数、作业组等）和我的提交（`work`：提交时间、迟交、提交方式、文本、网址、文件名），导入成待办的作业也保存（`task_id`，与 `assessment_id` 二选一）；待办移进成绩册后，这一行跟着改指向考核。提交的文件只存名称，文件本身不下载。作业列表被截断时保留原来保存的作业内容。作业是测验时（`Assignment.quiz_id`）连同测验的事实（题数、时限、可答次数等，`details.quiz`）一起保存，读不到测验列表时保留上次的；待办在同步期间被删掉的那一行直接跳过，不让整门课的这一阶段失败。
- **省请求**：每次同步对整门课只读一次提交（provider 契约 `submissions(course_id)`，Canvas 是 `GET /courses/:id/students/submissions?include[]=submission_comments&include[]=rubric_assessment`，不带 `student_ids` 就是本人的），不按作业逐个读。评分细则取自同一次同步里 `assignments` 阶段读过的作业列表（进程内缓存）。提交列表被截断时，没出现的作业保留原来的反馈。
- **跟随**：每次同步都用平台的当前内容覆盖，平台上改了或删了评语，本地也跟着改或删。
- **最近更新**：有别人写的新评语（按评语 id 判断；平台没有 id 时按时间与内容），或评分细则第一次有得分时，记一条 `lms_sync_changes`（`field = feedback`，状态里的 `SyncChange.kind` 为 `feedback`，字段改动为 `field`，前端按 `kind` 区分，`new = {comments: 新评语条数, rubric: 是否第一次按评分细则评分}`），出现在状态行面板的“最近更新”里，点开就地打开作业详情的“提交与反馈”（§7.3）。它不能撤销（`toggleable` 恒为假）；通知见 M18 §4.4。第一次读到某个考核时（新导入、新绑定、迁移后的第一次同步）已有的反馈不报。
- **读取**：成绩册读 `lms.assignment.targets`（只读库），每项带 `feedback`（有别人写的评语或评分细则得分，`sync_kept.has_feedback`），决定“作业”列的按钮是“查看作业”还是“查看反馈”；同一时刻考核的绑定优先：重新绑到另一份作业后、下次同步前，保存的旧作业那一行不再算这个考核的对应。Sem 读课程内容时直接用 `sync_kept.feedback_list`（2026-11-20 删掉了只给成绩册用的 `lms.feedback.list` 接口）；内容由作业详情读 `lms.assignment.get`（§7.3；PR 4 起改为镜像优先，本段的 `kept`/`kept_at`/`problem` 由 `source`/`as_of`/`held` 取代，§3.1）：先问平台，问不到（连不上、课程不再关联、作业在平台上没了）且作业导入过时，返回这里保存的内容，并标明 `kept`、保存时间 `kept_at` 与原因 `problem`。`lms.submission.get` 已删除。数据变化时发 `lms.kept.updated {course_id}`（可合并）。
- **解绑与取消关联**（owner 2026-11-18：评语是解释成绩的，成绩留下评语也留下）：反馈属于考核，不属于它与平台的对应关系（`lms_imported_refs`）。解绑、取消关联、更换关联的课程或删除使用中的连接后，评语保持最后一次读到的样子，不再随平台更新（同步已经找不到它）；对话框的平台名与“在 {平台} 中打开”用行里存的 `provider` 与 `web_url`，不依赖关联。考核删除时反馈随之删除（外键级联）。绑定到另一份作业时（`assignment_id` 变了），下次同步按第一次读取处理，悄悄换成新作业的反馈，不报新评语。这几处确认文字都写明保存的老师评语会保留，文档同样说明。
- **导出**：反馈单独一个列表（`LmsPayload.feedback`，按考核与课程的 id 映射，没跟过来的跳过；可省略；评语、评分细则与得分用与接口相同的模型校验，格式不对的备份在导入时就被拒绝），备份格式版本不变；没有这一项的备份导入后，下次同步再读回来。

#### 4.2 课程资料进入文件（2026-11-16，迁移 0053）
- **范围**：同步阶段 `files`（`sync_files.py`，order 60；读平台与判断在 `material_reads.py`，课程文件那一侧（内容源、订阅、恢复、“暂时无法同步”里的移除）在 `material_items.py`，共用的状态表在 `materials.py`）把平台上课程的文件（`course_files`，feature `folders`）、页面（`pages`）和单元里的文件、页面、外部链接与外部工具（`modules`）带进 M07 的课程文件。只看 provider 的 `features`，不写平台名。按 M11 命名空间 `lms.materials` 的 `sync`（全局与课程两级，课程默认跟随全局，默认开；2026-11-18 从 `lms_course_links.files_sync` 搬过去，迁移 0057；迁移 0060 从 Program 级改为全局级，Program 的值复制给没有自己设置的课程；`sync_enabled=false` 时整个同步不跑）。打开时立即排一次同步。
- **不占存储**：文件与页面建成 M07 的“远程文件”（`storage_key` 为空，`source_kind="lms"`；对应哪份资料只记在 `lms_materials.item_id`，平台版本只记在 `source_version`，见 §4.6），内容经 M07 的内容源（`register_content_source("lms", open_source, names)`）在打开、预览、建索引时从平台读：文件走 `reads.open_file`，页面现读正文渲染成带 `<h1>` 标题的 HTML 文档。链接建成 M07 的链接项。锁定（未开放）的文件和隐藏的文件、文件夹跳过，开放后下一次同步再加入。
- **按平台目录放**（2026-11-18，迁移 0060，取代按类型归类与模型定类）：`_place` 给每项算出它在平台上的位置，每一级是（id，名称）：所在单元（`module:<id>`）；否则文件区里的文件夹（`folder:<id>`，provider 在 `FileMeta.folder_ids` 给出各级文件夹 id，没有时按路径名）；否则第一个链接它的页面的位置加上该页面（`page:<slug>`，页面在同步里本来就按 slug 识别）（首页链接一切，不算；页面互相链接时不成环）。有这类子项的页面自己也放进以它命名的文件夹。只有链接、自身文字不到 160 字的页面是“列表页”，不保存，它列出的东西放进以它命名的文件夹。文件夹由 M07 的 `SourceFolders` 建立并记住（`files_source_folders`），最多三级。不按周归类（owner 2026-11-17），不再调用模型。
- **记录与用户优先**：每个带进来的东西在 `lms_materials` 记一行（迁移 0056 从 `lms_imported_refs` 搬过来，原来的状态都在 `snapshot` JSON 里），项是 `item_id`，上次应用的平台标题、版本、项名、位置（`path`）与放进的文件夹（`placed_folder_id`）各是一列。每项只在第一次带进来时放一次：用户移动、改名、删除都不会被同步改回（删除见下面的「状态」）；平台改了名而用户没改的才跟着改名（只改名，不重新处理）；平台上换了位置的不自动移动，由 M07 的「整理」提议移回（`homes`：项还在 `placed_folder_id`、而平台位置对应的文件夹不同；迁移 0060 用原来的类型文件夹填 `placed_folder_id`，升级后第一次同步填 `path`）。来源文件夹被删时，那个位置的新资料放进上一级，也不再重建（owner 2026-11-17：不从用户放别的资料的位置去推断）。文件的版本取 `FileMeta.content_at`（Canvas 的 `modified_at`，没有时用 `updated_at`），链接的版本是 url；版本变化的文件更新大小、版本与平台修改时间并重新处理（本地副本先放掉字节，再由本轮按保存方式重新存）。新建的项每 100 个（`BATCH`）一个事务写入、提交后放开写锁再接着写，一轮带进全部（2026-11-22：原来每轮最多 100 项、没有续跑，300 个文件要 3 轮、600 次单文件读取）；只由单元或页面露出的文件逐个读取改成并发（`reads.files_many`，同一轮里的页面也并发读，`reads.pages_many`），用户删掉的项（`dismissed`）同样按 `CHECK_EVERY` 限频。
- **发现**：页面里链接到的文件和页面、只在单元里出现的文件也会带进来（逐个读取）。没变化的页面复用记下的链接（`lms_materials.links`）；单独读的文件与页面一天最多查一次（`CHECK_EVERY`，`checked_at`）。列表页也记一行（`state="list"`，没有项），只为下次判断它变没变。
- **平台上删除**（2026-11-18；2026-11-22 起“没有了”只由表 3c 的 `rules.presence` 判断，`material_reads.judge`，原来的“这一轮读全了才判断、`_Found.complete`”已取代）：判断为已离开的：有本地副本的文件经 M07 `detach_from_source` 原地交给用户（变化记 `handed_over`，状态 `absent`，`item_id` 仍指向那个文件但不再跟随）；在线读取的文件与链接删掉（变化记 `gone`，状态 `absent`，`item_id` 清空）。两种平台再出现时都作为新资料带进来（2026-11-19 owner 决定：交给用户的那份不动，新带进来的按下面的规则多半记为 `duplicate`，由用户决定留哪份；原来是永远不再带回，取消发布再发布的文件因此一直不更新）。平台上被锁定的项（模块项、文件或页面的 `locked`，`material_reads.Found.locked`）不算删除，保持原样，解锁后继续跟随（2026-11-19：原来当作删除，存了副本的锁定再解锁后永久脱离同步）。两种都记进面板的最近更新。新带进来的文件与用户自己的某个文件（不跟随来源的，M07 `sources.same_file`，用户自己的文件每批读一次 `sources.own_files`）同名且大小相同时，照常带进来，变化记为 `duplicate`（首次同步也记），面板写“与你的某个文件同名且大小相同”，由用户决定留哪份（2026-11-19）。原来是资料、现在成了列表页的也删掉。
- **重试**：读取失败的远程文件（`files.source_unread`，或 `lms.*` 错误超过 1 小时，`RETRY_AFTER`）在下一轮同步时重新处理。
- **保存方式**（2026-11-18 PR 3）：`lms.materials.store`（`online` 从平台读取 / `local` 保存在 Semestra，默认 `online`，两级；2026-11-19 界面改用这两个名称，存的值不变）。资料的解析（含扫描页识别）遵守 M07 的 `auto_index`，没有单独的设置。两种保存方式都跟随平台。每轮同步调用 M07 的 `apply_copies`，改成 `local` 时（订阅 `settings.values.updated`）也立即调用，改成 `online` 时只给课程排一次同步（放掉副本只对这一轮平台给出了它本身的项做（它所属区域的列表里有，或单独读到，表 3c 注；2026-11-22，原来是只在读全了课程的一轮里做），课程在平台上关闭、单项暂时读不到时副本可能是唯一的一份，留着；平台拒绝给出副本（`lms.not_found`/`lms.forbidden`）的文件 1 小时内不再重排副本任务）：每个文件按自己的 `files_items.keep_copy`（用户在 ⋯ 菜单里的选择，空 = 跟课程设置）决定要不要副本，不要的立即放掉字节，要的每个文件排一个 `files.store_synced_copies`（`background` 通道、优先级 -1（同步资料的解析 `files.process_synced` 是 -2，排在副本之后，所以要保存的文件从副本读取，不再下载两次）、不进列表，去重键 `files.store_synced_copies:<item_id>`，`again=True`；2026-11-20 后端评审：原来一门课一个任务，几十上百个文件下载完之前，唯一的后台 worker 不会去跑别的课程的同步，排队时新加的文件也会被去重丢掉、要等下一轮）；入队前按平台给的大小筛掉超过上传上限和剩余配额的，配额满时不再下载，单个文件失败只记在该文件上。文件不再要副本时（课程改回从平台读取后的那轮同步），还没开始的副本任务撤回、正在存的那个不再重跑（`_drop_queued_copies`）：同步优先于副本任务，所以撤回在它们运行之前。改了 `lms.materials.store`（课程级只清这门课；账户级清所有跟随账户设置的课程）时，同一事务里清空这些课程里各文件的 `keep_copy`，以最后一次明确的操作为准（owner 2026-11-19；`settings.values.updated` 因此也在事务内发一次，`material_items.on_store_changing` 调 M07 `sources.reset_copy_choices`）。迁移 0057 把原来的 `files_offline=1` 写成课程级 `store=local`，用户保留过的离线副本（`kept_offline`）变成 `keep_copy=1`，仍跟随平台。
- **关闭同步**：`sync=false` 只停止这个阶段，已有资料保留，不再更新。设置里资料设置下方的“已同步的资料”一行（`lms.material.count_left`，账户级统计所有资料同步已关闭的已关联课程，课程级只看这一门）给出留下的数量，“移除…”经确认调用 `lms.material.remove_left`（2026-11-20）：在写锁下（拿锁后才读设置）把这些课程里 `synced` 的资料（跳过用户单独保存的，即 `keep_copy` 为真的项：Canvas 标签页“保存到课程文件”或文件菜单“保存在 Semestra”，计数用同一筛选）先记为 `absent`（所以 `files.item.deleted` 不会把它们当成用户删除而记为 `dismissed`），再用 M07 `sources.purge_items` 删掉对应的项，本地副本一起删；重新打开同步后它们作为首次同步再带进来。没有可移除的返回 `lms.sync_nothing_to_resolve`。capability 是 `destructive`，个人令牌受“允许删除”开关约束。同步阶段在写锁下重读资料设置，读平台期间被关闭的就直接结束，不把刚移除的资料带回来。
- **另存副本**：`lms.file.save_to_course`（Canvas 标签页的「保存到课程文件」）与 ⋯ 菜单勾选「保存在 Semestra」同义：同步已带进来的就对那一项调用 M07 的 `keep_copy`；否则下载后建一份 `source_kind="lms"` 的文件（`keep_copy=True`，`save_bytes_as_file(version=…)` 带上平台版本，副本一开始就是当前版本），记下引用，之后照常跟随平台。
- **取消关联**：`_remove_link` 在同一事务里发 `lms.course.unlinking`，`sync_files` 订阅它删掉这门课同步带来的项；有本地副本的交给用户、在线读取的删掉，文件夹保留，副本经 M07 `detach_from_source` 清掉 `source_kind` 与平台地址，成为用户的普通文件。
- **与 M07 的边界**：本模块只经 M07 的 `files/sources.py`（跟随来源的文件：建远程文件与链接、更新、重试、存副本、交给用户、删除）和 `files/source_folders.py`（平台位置对应的文件夹）使用文件模块，不直接读写 `files_*` 表；内容源用 `semestra.modules.files.register_content_source` 注册。
- **状态**（2026-11-18 PR 3，`lms_materials.state`；2026-11-19 结构性重写取代 #381）：`synced` 跟随中（只有它有跟随的 `item_id`）；`list` 只列链接的页面；`dismissed` 用户删了这一项（订阅 M07 的 `files.item.deleting`，在删除的事务里记下，同时发 `lms.sync.updated`；PR 6 前订阅提交后的 `files.item.deleted`），不再带回，状态面板“已移除”里列出；`absent` 不在文件里，平台上出现就带进来（平台上删了，或用户恢复了）。状态只由 `materials.enter` 改：它按 `NEXT` 表检查转换（表外的转换直接报错），并保证每个状态的内容：进入 `synced` 时记下新的 `item_id` 并清空已应用的平台信息（版本、名称、位置、链接）；进入 `list`/`absent` 时也清空，所以重新进来时一定整份读取（原来恢复后页面在平台上没变就被当成“已读过”跳过）；`dismissed` 保留读到的内容（它链接的东西照常带进来）。同步一轮先读平台，再在写锁下按每项发生了什么调用 `enter`。`lms.sync.material.restore`（`POST /lms/sync/materials/{id}:restore`，只给 HTTP）把 `dismissed` 改成 `absent` + `quiet`（带回时不算新资料、不通知）并排一次同步；`lms.sync.material.restore_all`（`POST /programs/{program_id}/lms/sync/materials:restore`，只给 HTTP）在一个事务里恢复 Program 下资料在同步的课程里所有 `dismissed` 项，每门课排一次同步，面板“已移除的资料”标题旁的“全部恢复”（多于一项时显示，折叠时也在）调用它。恢复后读全了课程的一轮发现平台上已经没有它：记为 `gone` 并去掉 `quiet`，不会一直等着。课程的资料同步关着时没有东西能把它带回，所以“已移除”不列出这些课程的，恢复返回 `lms.sync_nothing_to_resolve`。2.1.0 时用户转存过的文件（`source_ref` 已为空、资料仍是 `synced`）由迁移 0063 与同号的 reshape step（`lms/older_backups.py`）一次记成 `dismissed`：文件是用户的，平台上那份不并排带进来，要的话可以恢复（原来每轮同步开头都检查一遍）。2.0 的 Canvas Tab「保存到课程」存下的文件有自己写法的 `source_ref`（`lms:<provider>:<connection>:file:<id>`）却没有资料行，界面上显示跟随平台，实际不跟随，同步还会把平台上那份并排带进来（2026-11-20 #405 评审）：迁移 0066 与同号 reshape step 把它们读成现在保存时的样子，即课程仍经同一连接关联、且该资料还没有跟随中的文件时成为资料的文件（`synced`，`keep_copy`，版本未知，下一轮整份读取），否则成为用户自己的文件（副本的哈希从 `source_version` 取回）。用户改名靠 `name` 判断：它只在同步给文件命名时写入（新建、跟随平台改名），用户的名字永远不会写进去，所以改过名的文件在之后的内容更新里保留用户的名字（原来每轮都把当前名字写回 `name`，中间隔一轮同步后改名就丢了；迁移 0061 和旧备份的导入把跟随中的项的 `name` 改回同步给的名字，已经改过名的文件由此重新被认出）。平台标题经 M07 的 `sources.name_from_source` 变成文件、页面、链接与文件夹的名称（2026-11-20：斜杠和反斜杠换成 `-`，去掉控制字符，最长 255；原来文件和页面用上传文件名的 `safe_name`，“Lecture 1/2 notes.pdf” 只剩 “2 notes.pdf”，链接用用户输入的 `clean_name`，标题带斜杠就抛校验错误、让整门课的资料阶段每轮失败）。是否“平台改了名”比较的是按这条规则得到的名字与 `name`，所以 2.4 及以前被截短、用户没改过的名字会在下一轮同步补全；链接的地址不是 http(s)（`mailto:` 等，M07 不收）时改用平台上该条目的页面地址（`web_url`），都不行才不带进来。同步读取期间恢复的项（`state_at` 晚于这一轮开始读的时间）不在这一轮判断“已从平台删除”，交给结束后的再一轮。迁移 0061 把 `restored`/`gone`/`handed_over` 改成 `absent`（`restored` 的带 `quiet`）。备份格式版本不变：导出只含 `synced` 与 `dismissed`，旧备份里的 `handed_over` 在导入时略过（文件本身是用户的，资料在平台出现时会重新带进来）。
- **运行中再请求同步**（2026-11-19）：`sync.queue` 用 `enqueue(..., again=True)`（M00 §3.7）：同一门课的同步正在运行时再排，会在它结束后再跑一次（恢复、改设置、立即同步都靠这一处保证，那一轮可能在请求之前就读过课程）。打开应用时的请求（不带 `force`）跳过正在同步的课程。
- **变更记录**（2026-11-18 PR 3）：`change`/`changed_at` 记最近一次平台带来的新增、内容更新（只改名不算）、删除与交给用户；`lms.sync.status` 的 `materials`（`SyncMaterialChange`，带项与所在文件夹名）与作业的最近更新一起按课程列出，`removed_materials` 列出 `dismissed` 的最新 50 项，`removed_count` 是总数。与作业变更记录一样保留 14 天（`forget_old_changes`）。第一次同步一门课（`lms_course_links.materials_settled_at` 为空，直到第一轮写完）不记变化、不标新、不通知：关联课程带来的几百份资料不是“新”的。资料同步从关到开时（`on_settings_changed`）也清空 `materials_settled_at`：关着时平台上新增的同样不算新。
- **新资料**：之后新建的项标 M07 `files_items.unseen`（文件页名称后的蓝点，打开预览时 `files.item.mark_seen` 清掉），并作为 `Notice("material", …, item_id)` 随 `lms.course.synced` 交给 M18。
- **出站**：远程文件的预览与下载经后端代理读取平台（与 `reads.open_file` 相同），不改成浏览器直连；本功能以自部署为主（owner 2026-11-16）。
- **前端**：全局设置 LMS 组的“课程资料”分区与课程设置 LMS 分区下的“课程资料”块是 `lms.materials` 的 `NamespaceForm`（课程级每项可跟随全局；描述与选项说明经 `params` 带上平台名）。LMS 组还有“同步”（频率）、“作业”（自动更新的字段与提交后完成待办）、“通知”（`notifications.lms`，与通知设置里同一项）、“平台权限”和“内容显示”，同步相关的设置都在这里（owner 2026-11-18）；取消关联的确认框列出 `lms.course_link.get` 返回的 `materials`（本地副本 / 在线读取的数量）；状态面板的最近更新里资料行点名称关闭面板并打开该文件（M07 `filePath`），最下面“已移除 N 项”可恢复；`files.itemActions` 贡献“在 {provider} 中打开”（`source_kind="lms"` 的文件与页面，打开 `url`），文件菜单里显示，预览对话框标题栏与“无法预览”时也作为按钮显示。

#### 4.3 公告保存在 Semestra 里（2026-11-18，迁移 0058）
- **保存**：同步阶段 `announcements`（`announcements.py`，order 40，provider 有 `announcements` 功能时运行）读最近 180 天（`LOOKBACK`）的公告，写进 `lms_announcements`。平台上改了的（标题、正文、作者、时间、附件）跟着改；这次读全了（没有截断）时，平台上删掉的公告在这里也删掉，只删 `LOOKBACK` 之内的（更早的没问过平台，保留）。课程列表、学期列表、公告卡片、命令面板与 Sem 都只读这张表，不再实时读平台，所以平台连不上时也能读。列表里每条公告带 `text`（正文去掉标签后的一行纯文本，读取时由 `html.to_text` 算出，不入库），公告列表与 Canvas 标签页的摘要、命令面板的正文搜索都用它，前端不再解析 HTML（2026-11-20）。读本地很快，所以公告不放进 `keptQueries`，不会先显示浏览器里保存的旧列表和旧未读点。暂停同步的课程和已结束的学期保留已有的公告。Canvas Tab 的「刷新」除了清缓存，也立即排一次这门课的同步（`force`）；用户对单门课要求的同步（`lms.sync.request` 带 `course_id` 和 `force`）也读学期已结束的课程（后台同步只看结束不到 30 天的），暂停同步的课程照旧不读。
- **已读**：已读状态是 Semestra 自己的（`read_at`），不需要写平台的权限。打开公告就调 `lms.announcement.mark_read` 标为已读。账户设置 `lms.allow_writes` 打开且 provider 支持 `mark_read` 时，在这里读过也写回平台：本地标记随请求提交，写回在提交后的后台任务里做（`events.spawn` + `run_as_system`，不带着写锁等平台；尽力而为，失败只记日志），同步时平台上已读的也在这里记为已读；关着时两边互不影响。
- **未读与通知**：一门课第一次被读（`watched_at` 为空，包括新关联的课程；迁移把所有关联的 `watched_at` 清空，升级后第一次同步不报旧公告）时，已有公告都记为已读，不发通知。之后新出现的公告是未读，发布时间在 2 天内（`STALE`）的写进 `lms.course.synced` 的 `notices`（M18 发通知）。`lms.announcement.unread`（`GET /programs/{id}/lms/announcements/unread?term_id=`）按课程给出未读数，课程与学期的「公告」标签用它显示数字。存储变化（以及第一次读一门课）时发 `lms.announcement.updated {course_id, program_id}`（可合并），前端据此刷新列表与未读数。
- **还没读过**：课程与学期列表的 `not_read` 说明为什么还没有公告：`waiting`（下次同步会读）、`ended`（学期已结束，后台同步不再读，课程页给「立即同步」）、`paused`（这门课暂停了同步）；学期里各课不同时按这个顺序取第一个；都读过或平台没有公告功能时为空，页面显示「暂无公告」。
- **附件**：provider 契约的 `Announcement.attachments`（`Attachment`：外部 id、名称、mime、大小），Canvas 取公告的 `attachments`。输出时每个附件带 `file`：课程资料同步（§4.2）已带进课程文件的，给出文件项（`AppTarget`），界面在文件预览中打开；没有的经文件内容代理（`/courses/{id}/lms/files/{file_id}/content`）在新标签页打开，仍然留在 Semestra 里，不跳到平台。附件带 provider 给的下载地址（`Attachment.download_url`，Canvas 的带 verifier，不发给客户端、不进备份），代理遇到已保存公告的附件时直接用它，不再查文件元数据（课程隐藏了「文件」页时学生查不到附件文件）。尚未用真实 Canvas 账户验证。
- **链接**：清洗后的 HTML 里平台内链带 `data-lms-kind`/`data-lms-ref`（§2.1）。输出时 `targets` 给出其中在 Semestra 里有对应的：课程文件与页面（`lms_materials` 的项）→ 文件项，已导入的作业 → 考核或待办。对应关系在读取时计算，所以之后才同步或导入的也能打开。界面里文件与页面打开文件预览，考核打开成绩页上的那一行（`grades?assessment=`），待办打开课程的待办页，同一门课的另一条公告在「公告」页打开；正文里指向不在课程文件中的平台文件的链接与附件一样经文件代理在新标签页打开；其余没有对应的链接仍是平台地址，在新标签页打开。
- **图片**：平台上课程文件的图片地址要平台的登录会话（Canvas 的 `/courses/:id/files/:id/preview` 未登录时跳到登录页），所以带标记的图片改由文件内容代理加载，失败时退回原地址（`SafeHtml` 的 `imageSrc`，与 Canvas Tab 共用）。
- **显示方式**：账户设置 `lms.display`（`simplified`/`original`，全局设置 LMS 组「内容显示」）是「公告」页与 Canvas Tab 的默认显示方式（2026-11-18 从插件命名空间 `plugin.canvas-tab` 移来，不保留旧命名空间；2.0 里选过的值由迁移 0064 移过来，`lms` 里已经选过的为准，旧行删除；2.4 及更早的备份由 0064 的 reshape step（`lms/older_backups.py`）读成 `lms.display`）。页面上的显示方式菜单只改当前页面，在页面打开期间对之后打开的每一项都保留，不保存（`modules/lms/content/display.ts` 的 `useLmsDisplay`）。
