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
- 错误映射：带 `WWW-Authenticate` 的 401 → `lms.invalid_credentials`；不带的 401（已登录但某个页面或文件被锁）和普通 403 → `lms.forbidden`；403 且正文含 `Rate Limit Exceeded` 或 `X-Rate-Limit-Remaining` 已降到 0 → `lms.rate_limited`（Canvas 默认用 403 限流，站点开启后才用 429；没有 `Retry-After`，按 60 秒）；429 → `lms.rate_limited`（带 `retry_after`）；404 → `common.not_found`；网络错误或超时 → `lms.unreachable`；私网地址 → `lms.blocked_address`；学校登录未开启 → `lms.sign_in_disabled`；Canvas 不认识该校 → `lms.sign_in_unavailable`；学校登录用了 http 地址 → `lms.sign_in_https_required`；粘贴的回调无授权码/已过期 → `lms.sign_in_failed`。

### 2.4 读缓存
所有读取接口都经过模块级缓存：先查进程内 LRU（按字节限 64 MB），再查 SQLite `lms_cache`，TTL 5 分钟。缓存键为 `(user_id, connection_id, 方法, 参数)`，每条带范围（`course:<外部课程 id>` 或 `calendar`），凭证更新时清除该连接的全部缓存，`lms.course.refresh` 只清一门课的范围和日历。请求带 `?refresh=true` 时绕过缓存。读取不在请求事务里写库：`lms_cache` 在请求提交后用单独的短事务写入。

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
  sync_enabled (default true), synced_at?, sync_errors {阶段: 错误码}, watched_at?,
  created_at, updated_at
  UNIQUE(program_id, connection_id, external_course_id)

lms_imported_refs                    # 平台上的作业与它在 Semestra 里的对象（同步的依据）
  id, user_id, link_id, external_kind ('assignment'|'calendar_event'), external_id,
  target_kind? ('assessment'|'task'|'event'), target_id?, imported_at?,   # 都为空 = 还没导入的新作业
  snapshot, conflicts {字段: {value, raw}}, removed_at?, dismissed_at?, submitted_at?
  UNIQUE(link_id, external_kind, external_id)   # 一个外部项只对应一个 Semestra 对象

lms_sync_changes                     # 同步写过的字段，面板里可撤销，保留 14 天
  id, user_id, ref_id → lms_imported_refs (CASCADE), field, old?, new?, at, reverted_at?

lms_cache  key, user_id, connection_id, scope, payload, expires_at
```
规则：
- 课程关联的 `connection_id` 必须等于课程所属 Program 的绑定连接，否则返回 `lms.program_not_configured`。
- Program 已有关联时更换或删除绑定 → `lms.program_has_links`（params: count）。
- 删除连接：要求该连接没有 Program 绑定。界面提供"同时解除所有绑定与关联"选项，选择后在同一事务中解除；已导入的考核、待办、文件保留。
- 年课（跨多个学期的一门课程）只有一个关联，这与 M02 的课程模型一致。

## 4. 同步语义
- 浏览类数据（公告、单元、页面等）实时读取，有缓存。
- 作业由后台同步（§4.1）跟随平台；课程本身（名称、学分等）不跟随，同步只刷新关联的外部元数据（代码、名称、学期、web_url）。
- 日历叠加：`lms.events` 日历源实时读取 `sync_enabled=true` 的已关联课程（每个连接合并为一次 `calendar_events` 调用）。只有平台的日历事件，作业不在这里出现，所以不需要与考核或待办去重。
- 提交后完成待办（`lms/submissions.py`，账户设置 `lms.complete_submitted`，默认开）：每次读取课程作业（Canvas Tab、导入、后台同步）后，在单独的事务里把平台上第一次显示已提交（`submission.submitted_at`）的导入作业记入 `lms_imported_refs.submitted_at`，并完成对应待办：导入成待办的就是该待办，导入成考核的就是考核的待办（M05 `service.complete_open`）。每个作业只做一次，用户之后取消勾选不会再被勾上；设置关闭时什么也不记，重新打开后补上期间提交的。
- `sync_enabled=false`（课程设置的“同步这门课”）：该课程不出现在日历叠加中，也不做后台同步和提交后完成待办；读取接口和 Canvas Tab 仍然可用。

### 4.1 后台同步（2026-11-12，迁移 0046）
- **任务**：每门课一个任务 `lms.course.sync`（去重键 `lms.course.sync:<course_id>`，`listed=False`：不进状态栏的任务列表，同步有自己的状态行）。按顺序跑注册的阶段（`sync.register_sync_stage(name, run, order, enabled)`）：`course`（0，刷新关联的外部元数据）、`assignments`（20）、`announcements`（40）；M07 的文件同步以后作为新阶段加入。每个阶段先读平台、再在自己的事务里写；出错的阶段把错误码记进 `lms_course_links.sync_errors`，其余阶段照跑；只有第一个阶段失败（读不到课程本身，多半是连接坏了）才结束这次同步。全部跑完后推进 `synced_at`，发 `lms.course.synced`（`{course_id, program_id, manual, applied[{change_id, name, field}], notices[{kind, external_id, title}], pending, errors}`）与 `lms.sync.updated {program_id}`。连接错误照常由 `service.attempt` 记到连接上（替代原来每 6 小时的 `lms.refresh_status`）。
- **什么时候同步**：① 定时任务 `lms.sync_due`（每 5 分钟一轮，每轮最多排 20 门课，最久没同步的先排）排上次同步早于账户设置 `lms.sync_every` 的课程；只看 14 天内用过应用的账户（离开更久但开着学习平台通知、有推送设备的账户照常同步，否则通知收不到），`sync_enabled`、连接有凭证、学期在进行/未开始/结束不到 30 天的课程。② 打开学业项目时前端请求一次（`lms.sync.request`，不带 `force`）：只排 30 分钟内没同步过的。③ 用户手动（状态行面板“立即同步”、命令面板“同步学习平台”、课程设置的“立即同步”，`force=true`）：全部排上。
- **频率**：`lms.sync_every` ∈ 15m / 30m / 1h / 6h（默认）/ 1d。环境变量 `SEMESTRA_LMS_SYNC_MIN_INTERVAL`（默认 `15m`）是下限：设置表单经 `register_settings(adapt=…)` 只列出不短于下限的选项，已存的更短值按下限执行。托管版设为 `1h`。
- **作业怎样跟随**（`sync_assignments.py`）：字段为标题、截止、权重（按作业组推算的实际权重）和成绩（只对考核）。对每个字段比较平台值 p、快照 s 与本地值 mine，决定由纯函数 `rules.merge(字段, s, mine, p, 自动更新开关) → Action` 给出（相等一律用 `rules.same`：权重与成绩差 0.005 以内、成绩按百分比，截止按分钟），同步阶段、`different` 列表（`rules.diverged`：结果是 KEEP 或 CONFLICT，或平台为空（CLEAR）而本地有值）和 `lms.sync.field.resolve` 都只调用它，`tests/test_rules.py` 按表覆盖全部组合；平台把权重或成绩清空 → CLEAR；p = mine → 推进快照；p = s → 平台没改，保留用户的值；mine = s（或权重从没设过）→ 写入 p（经 `grading.assessment.update` / `tasks.item.update`），记一条 `lms_sync_changes`，推进快照；但用户在账户设置里关掉了这个字段的直接更新（`lms.follow_title` / `follow_due_at` / `follow_weight` / `follow_score`，默认都开，owner 2026-11-12）时，改为记进 `conflicts`（`edited: false`）先问；否则两边都改过 → 记进 `conflicts`（`edited: true`）等用户决定。p = s 时同时清掉这个字段旧的冲突：用户已经把值改成别的或平台改回去了，就不再询问。平台上不见了的已导入项记 `removed_at`（作业列表被截断时不判断）。还没导入、截止在未来的作业建一条没有 target 的记录，作为“新作业”提醒；过了截止、或在平台上消失的未忽略记录直接删掉。`lms.assignment.bind` 绑定手动添加的考核时快照用 `bound_snapshot`（截止、权重、成绩记为未见），所以下一次同步补上考核缺的值、两边都有且不同的作为冲突询问。
- **用户的回答**：按字段回答 `lms.sync.field.resolve`（`{item_id, field, choice}`：被询问的字段 `platform` 取平台值并记一条 `lms_sync_changes`、`mine` 保留自己的值，两者都把快照推进到这个平台值、只清掉这一个字段的冲突；“不同”列表里的字段只能 `platform` 改回；面板每个冲突字段一行）、删除项 `lms.sync.resolve`（`keep`/`delete`）、`lms.sync.dismiss`（忽略或重新提醒新作业）、`lms.sync.change.revert`（撤销一条变更：写回旧值，快照保持平台值，所以下次不会再改回去）。`lms.sync.change.reapply` 撤销还原（再写回新值）。两者都只对同一字段最新的那条、该字段没有待回答的冲突、且本地值仍是上一步留下的值（未还原时是新值，已还原时是旧值）有效（`SyncChange.toggleable`，面板只给这些行按钮）；否则 `lms.sync_change_outdated`（409），免得覆盖用户之后改的值。这些接口都返回最新的 `SyncStatus`。
- **状态**（`sync_status.py`，只读库）：`lms.sync.status` 返回连接错误、频率、课程数、最早的 `synced_at`、是否在同步、待处理（冲突、删除、新作业，按截止排序）、已忽略、最近 14 天的变更（最多 50 条）、与平台不同的字段（`different`）和各课程的阶段错误。
- **与平台不同的字段**（2026-11-12，owner 选甲）：已导入、没有待回答冲突的字段里，本地值和快照（上次看到的平台值）不同的就是 `different`（`SyncDifference`：item、字段、本地值、平台值、`target_kind`/`target_id`）；平台值为空、本地填了值的字段（没有截止、还没成绩、没有权重）也算（owner 2026-11-12 选“全部字段”），改回就是清空（权重写 0，`rules.held`）。它们不算待处理，状态行不提醒。`lms.sync.field.resolve`（`choice: platform`）把这个字段写回快照里的平台值；选 `mine` 保留的冲突字段之后就列在这里，随时可以改回（之后平台再改它时照常按 `lms.follow_*` 处理），并像同步写入一样记一条 `lms_sync_changes`，所以能在“最近更新”里还原。被还原、仍可撤销还原的字段只在“最近更新”里出现，不再列进 `different`。截止时间按分钟比较（Canvas 默认 23:59:59，Semestra 不存秒）。待办的截止是本地日期与时间（考核是时刻），快照记下这次读平台截止所用的时区（`zone`，导入与每次推进截止时写入）；学业项目换时区后，按旧时区读快照判断“用户有没有改过”，所以不算“不同”，下次同步按新时区跟随。同步阶段读完平台后先用 `sync.hold` 拿写锁再读要比较的本地值，用户的回答（解决、忽略、还原、改回）也先 `hold` 再重读，二者不会基于对方提交前的状态互相覆盖（pysqlite 到第一条写才开事务）。平台把权重或成绩清空时快照也推进为空并清掉该字段的冲突。用户改了已导入对象的这些字段或删除它时（`grading.assessment.updated/deleting`、`tasks.item.updated/deleted` 的订阅，`subscribers.py`），发 `lms.sync.updated`（可合并），面板与编辑处的按钮随之刷新。
- **通知**（M18）：`notifications/watch.py` 订阅 `lms.course.synced`：新成绩与变更用 `hidden_only`，新公告只在 `notifications.lms = all` 时发。只改了权重的不单独通知。免打扰时段内的留到时段结束再发（M18 §4.4）。公告“新”看 `watched_at` 之后发布的；`watched_at` 为空或早于 2 天前时这次只记下现状、不报。
- **偏离计划**：同步写入不经过 M08 导入会话（原计划生成更新 session 再审核）。自动跟随的字段直接写，留下可撤销的变更记录；需要用户决定的在状态行面板里逐项回答，不打开导入审核。M08 的 `assessment_patch`/`task_patch` 随之删除。

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
| `lms.course.link.delete` | write | DELETE /courses/{id}/lms-link | |
| `lms.course.overview` | read | GET /courses/{id}/lms | 课程信息、导航、default_view、provider、功能标志 |
| `lms.announcement.list` | read | GET /courses/{id}/lms/announcements | |
| `lms.assignment.list` | read | GET /courses/{id}/lms/assignments | 每项的 `imported_as`（`{kind: assessment\|task, id}` 或空）；`new_ids`：未导入且未过截止的作业，按截止排序 |
| `lms.grade.list` | read | GET /courses/{id}/lms/grades | |
| `lms.module.list` / `lms.module_item.list` | read | GET /courses/{id}/lms/modules[/{module_id}/items] | |
| `lms.page.list` / `lms.page.get` | read | GET /courses/{id}/lms/pages[/{ref}] | 返回清洗后的 HTML |
| `lms.quiz.list` | read | GET /courses/{id}/lms/quizzes | |
| `lms.syllabus.get` | read | GET /courses/{id}/lms/syllabus | |
| `lms.file.get` | read | GET /courses/{id}/lms/files/{file_id} | 元数据 |
| 文件内容代理 | — | GET /courses/{id}/lms/files/{file_id}/content | `routes.py`，流式代理，用于预览和下载 |
| `lms.file.save_to_course` | write | POST /courses/{id}/lms/files/{file_id}:save | 调用 M07 `save_bytes_as_file`，`source_kind='lms'`，`source_ref={provider, connection_id, file_id}` |
| `lms.course.import` | write | POST /programs/{id}/lms/imports:courses | 选中的外部课程（可选目标学期）→ M08 session（course items，带关联信息），返回 session id |
| `lms.assignment.import` | write | POST /courses/{id}/lms/imports:assignments | 选中的作业 → M08 session：有分值的成为考核（assignment group → 课程已有分类或新分类，规则见 M08 的分类映射；权重按 group weight 推算，无法推算时留空），没有分值的成为待办 ；session 留给审核，由用户（或 Agent 经 `imports.session.commit`）提交 |
| `lms.assignment.add_to_gradebook` | write | POST /courses/{id}/lms/imports:gradebook | 已导入为待办的作业 → 考核（同一流程）；M05 让新考核接管同来源的待办，导入记录改指向考核 |
| `lms.syllabus.import` | write | POST /courses/{id}/lms/imports:syllabus | syllabus HTML → M08 文本抽取 session |
| `lms.sync.status` | read | GET /programs/{id}/lms/sync | 后台同步的状态（§4.1）；只开放 HTTP |
| `lms.sync.request` | write | POST /programs/{id}/lms/sync | `{course_id?, force}` 排同步任务，返回 `queued`；只开放 HTTP |
| `lms.sync.resolve` | write | POST /lms/sync/items/{id}:resolve | 回答平台上删除的项（保留/删除）；不是删除项 → `lms.sync_nothing_to_resolve`（409）；只开放 HTTP |
| `lms.sync.dismiss` | write | POST /programs/{id}/lms/sync:dismiss | `{item_ids, dismissed}` 忽略或重新提醒新作业；只开放 HTTP |
| `lms.sync.field.resolve` | write | POST /lms/sync/items/{id}/fields/{field}:resolve | 按字段回答：被询问的字段取平台值或保留，与平台不同的字段改回平台的值（§4.1）；都不是 → `lms.sync_nothing_to_resolve`（409）；只开放 HTTP |
| `lms.sync.change.revert` | write | POST /lms/sync/changes/{id}:revert | 撤销同步写入的一个字段；只开放 HTTP |
| `lms.sync.change.reapply` | write | POST /lms/sync/changes/{id}:reapply | 撤销还原，再写回同步的值；只开放 HTTP |
| `lms.course.outline` | read | GET /courses/{id}/lms/outline | Agent 用（第 8 节）：模块与全部条目（ref、锁定原因）、开放的栏目、外部工具、不在模块里的页面；`cursor` 分页 |
| `lms.content.search` | read | GET /courses/{id}/lms/search | Agent 用：搜页面正文、公告、作业、测验、讨论、大纲、文件名和链接 |
| `lms.content.read` | read | GET /courses/{id}/lms/content | Agent 用：按 ref 或 LMS 地址读任意条目的全文（Markdown），`offset` 分段 |
| `lms.activity.list` | read | GET /me/lms/activity | Agent 用：一门课或整个学期的新公告、新成绩和新作业 |

- 课程级读取接口要求该课程已关联（否则 `lms.course_not_linked`），并检查 provider 功能标志（否则 `lms.feature_unsupported`）。
- M08 提交时，item 的 `data.lms_ref` 带回外部引用。本模块订阅 `imports.session.committed`，写入 `lms_imported_refs`。导入课程时也在同一个提交里创建 `lms_course_links`（M08 的 course item 带 `data.lms_link`，本模块在 `imports.session.committing` 钩子里写入，保证在同一事务中）。

## 6. 事件与扩展
- 订阅：`academics.course.deleting`（删除关联与导入记录）、`academics.program.deleting`（删除绑定）、`grading.assessment.deleting` / `tasks.task.deleting`（删除对应的导入记录，之后可以再次导入）。
- 发出：`lms.course.synced`、`lms.sync.updated`（§4.1）、`lms.connection.status_changed`、`lms.course.linked`、`lms.course.unlinked`、`lms.course.imports_recorded`（`{course_id}`，M08 提交钩子记下导入的作业或更新的快照之后，前端据此刷新“平台上的新作业”和作业列表的“已导入为”）。
- 贡献：
  - 日历源 `lms.events`（M04 `calendarSources`）：在日历筛选面板中按连接显示；事件描述默认以纯文本显示，用户可以在源设置中开启"渲染 HTML 描述"（清洗后，开启前确认，与旧版一致）。
  - `academics.termWizardImportSources`：学期向导中的"从 LMS 导入课程"（要求 Program 已绑定连接，否则引导绑定）。
  - `grading.assessmentImportSources`：成绩页中的"从 LMS 导入作业"。
  - `academics.courseInfo`：已关联课程显示 provider 徽章、外部代码，以及"在 <provider> 中打开"。
  - Card `lms.announcements`（course/term 作用域，m/l 尺寸）：最近公告；term 作用域时汇总本学期所有已关联课程。
- 本模块定义的前端扩展点：`lms.providerUi`（见 2.1）。

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
  - **状态行**（`statusItems` 的 `lms.sync`，M10 §5.6）：学业项目绑定了平台就一直在。连接坏了是 `error`（“重新连接 {平台}”）；有待处理是 `attention`（`BellDot`，强调色，“{平台} · N 项待处理”）；同步中转圈；否则 `idle`（“{平台} · M 分钟前同步”）。点开是面板 `SyncPanel`：各课程的阶段错误，头部（平台、上次同步与频率或“正在同步 N 门课程…”、“立即同步”）固定，下面滚动；连接出错时（2026-11-12）没有 Alert 与“立即同步”：副标题红色显示原因与上次同步时间，右上角是主按钮“重新连接”（打开设置里的 LMS 连接），列表照常可滚动，保留/更新/删除/忽略/还原都只动本地数据所以照常可用，只有读平台的“导入”禁用；“待处理”“最近更新”“已忽略”都按课程分组（色点 + 课程代码），行是 shadcn `Item`。待处理：新作业每门课一行（outline 忽略 / 实心导入）；冲突“旧值 → 新值”（箭头是 `ArrowRight` 图标，新值正文色，`edited` 时加“你改过这一项”）：outline 保留 / 实心更新；平台上已删除：outline 保留 / destructive 删除（确认）。回答后的行 200 ms 高度收起，失败则展开回来。最近更新：可切换的行右侧是常驻的 outline 图标按钮（`Undo2` 还原 / `Redo2` 撤销还原，带 tooltip）；还原过的行变灰、新值删除线、副标题以“已还原 ·”开头。可折叠的“与 {平台} 不同 N”（数字和“待处理”一样直接跟在标题后）（默认折叠，每行“你的：… · {平台}：…”，常驻 outline 图标按钮 `CloudDownload` “改回 {平台} 的值”）。可折叠的“已忽略”（恢复提醒 / 导入）。编辑考核对话框与待办详情里，与平台不同的字段旁边有同一个图标按钮（扩展点 `fieldOrigins`，`components/FieldOrigins.tsx`，M09 贡献 `sync/FollowButton`），tooltip 显示平台的值，点按只把值填进表单，保存才写入（owner 2026-11-12：只要一个垂直居中的按钮，值放 tooltip）。（UI 评审 v3，owner 2026-11-12 批准。）
  - **打开时同步**（`SyncOnOpen`，manifest `overlays`）：打开学业项目时请求一次同步。同步的结果只体现在状态行上，不弹 toast（owner 2026-11-12：有状态行就够了）。
  - **命令面板**：“同步学习平台”（绑定了平台时可用），打开面板并强制同步。
- 作业导入可以接着做：同一门课（同一关联）还有等待审核的作业导入（`source_meta.lms.kind == "assignments"`、状态 `ready`）时，再次导入不新建会话，只把还不在其中的作业补进去（作业组对应的分类按 `source_meta.lms.groups` 复用），没有新作业就直接返回那个会话，前端打开它的审核。
- 未设置作业组权重的课程：导入的考核没有权重，带 `import.weight_missing`，所以会打开审核让用户填写（不按分值占比推算：课程总分变化后占比就过时了）。

## 8. Agent 集成
Agent 与 MCP 只看到 11 个按任务设计的工具，而不是每个平台接口一个工具（2026-11-08 重新设计，分析见资料库 `2026-11-08-LMS工具重新设计.md`；原则见 Anthropic《Writing effective tools for agents》、OpenAI function calling 最佳实践与 MCP 规范）：

| 用途 | 工具 |
|---|---|
| 读 | `lms.content.search`、`lms.content.read`、`lms.course.outline`、`lms.activity.list`、`lms.assignment.list` |
| 关联 | `lms.course.list`、`lms.course.link.set` |
| 写（走提案确认与 M08 审核） | `lms.file.save_to_course`、`lms.course.import`、`lms.assignment.import`、`lms.syllabus.import` |

其余 capability（逐个平台接口的读取、绑定、关联维护、`lms.assignment.add_to_gradebook`、`lms.sync.*`）只开放 HTTP，供 Canvas Tab 与设置页使用。

- **ref**（`refs.py`）：`<kind>:<id>`，kind 为 page、announcement、assignment、quiz、discussion、file，外加 `syllabus`。由服务端生成，模型原样传回；页面用 slug（可达 600 字符），其它用平台 id。LMS 文本的 Markdown 里平台内链写成 `lms:<ref>`。`lms.content.read` 也接受 LMS 地址（`rewrite_internal_link`）。导入与文件工具的 id 参数同样接受 ref。
- **`lms.area_hidden` 要导航确认**：读整个栏目的列表被拒（`lms.not_found` / `lms.forbidden`）时，只有课程导航里没有该栏目或标为隐藏，才报 `lms.area_hidden`；否则保留原错误（课程在平台上被删、学生被移出课程也会被拒）。
- **链接只认同一门课**：`InternalRef` 带链接所在的平台课程（`course`），`Bound.clean(…, course)` 只把指向本课程的链接标成可在应用里打开的条目；`lms.content.read(url=…)` 遇到别的课程的地址报 `lms.other_course`。模块链接在 Markdown 里保持普通地址（模块不是可读的条目）。
- **不带时区的时间**（`since`、`due_after`、`due_before`）按 Program 时区解释。
- **outline / search 只读开放的栏目**：从课程导航得出开放的栏目（`open_areas`），页面、文件、测验、讨论栏目被隐藏时不请求它们的列表（Canvas 会返回 404），在结果的 `skipped` 里注明 `hidden`；模块里的页面仍逐页读取。没有导航功能的平台视为全部开放。
- **搜索**（`search.py`，方案 A：读缓存 + 本地匹配，不建索引）：文档来自模块条目、页面正文（每次最多 60 页，`reads.read_many` 并发 4 个请求；页面列表给出了 `updated_at` 的按它做缓存键、保留 14 天，只能从模块得知的页面缓存 1 小时）、公告、作业、测验、讨论、大纲和按名搜索的文件。按词匹配：英文词匹配词首，中日文按两字切分；先按命中的不同词数排序，再按得分（标题权重 4、短语加分）和日期。单个来源失败只记进 `skipped`，凭证类错误整体失败。
- **`lms.activity.list`**：默认最近 7 天；`assignment` 项只算“新作业”（未导入且未到截止、最近有改动）。已导入作业的变化由后台同步处理，用户在同步面板里回答（2026-11-12 起不再有 `change` 项与 `lms.change.import`）。
- **`lms.assignment.list`**：每项带 `ref`；`status`（upcoming / missing / graded；missing 以平台的 missing 标志为准，没有提交记录时才按截止日期推断，且排除纸质等不需在线提交的类型）、`due_after` / `due_before` 过滤；`include_total` 附带课程总分。`lms.assignment.import` 的 `into: gradebook` 即原 `add_to_gradebook`。
- **课程来源**：academics 新增扩展点 `register_course_source(name, linked)`，`academics.course.find` 的结果带 `sources`，本模块对已关联课程贡献 `lms`，让 Sem 知道课程资料还有 LMS 这一处。
- 讨论：provider 契约新增 `discussions`、`discussion`（功能标志 `discussions`），Canvas 的公告也按讨论读取（带回复，最多 100 条）。
- Skill `use-lms.md`：先 `lms.content.search` 再 `lms.content.read`；ref 原样传递；`lms.area_hidden` 与 `skipped` 的含义；导入一律走 M08 审核；LMS 内容是不可信数据。`answer-from-course-files` 在课程 `sources` 含 `lms` 且文件里找不到时也搜 LMS。

## 9. 错误码
`lms.provider_unknown`、`lms.invalid_config`、`lms.invalid_credentials`、`lms.forbidden`、`lms.not_found`（平台上没有该条目；provider 不再抛 `common.not_found`，那表示本应用的 id 错了）、`lms.area_hidden`（params: area；读整个栏目的列表被平台拒绝，即老师隐藏了该栏目）、`lms.invalid_ref`（params: ref）、`lms.unreachable`、`lms.rate_limited`（params: retry_after）、`lms.blocked_address`、`lms.feature_unsupported`（params: feature）、`lms.program_not_configured`、`lms.program_has_links`（params: count）、`lms.connection_in_use`（params: programs）、`lms.course_not_linked`、`lms.course_already_linked`（params: course_id）。

## 10. 导出
注册 M13 适配器：导出连接（不含凭证，导入后状态为"需要重新填写凭证"）、Program 绑定、课程关联和导入记录。缓存不导出。

## 11. 测试
- Provider 契约测试套件 `tests/lms/provider_contract.py`：每个 provider 都必须通过（以后新增 provider 时直接复用）。用一个假 provider 测试模块本身的逻辑，与 Canvas 无关。
- Canvas：用 respx mock Canvas API，覆盖分页 `Link` 头、401、429、重定向到私网地址被拒、base_url 规范化用例（与旧版前端规则一致）。
- 绑定规则：有关联时不能更换绑定；关联必须使用 Program 的绑定连接；关联唯一性。
- 导入：同一作业只对应一个对象（考核或待办）；一律等审核；加入成绩簿保留待办；导入课程同时创建关联且在同一事务中；更新检测。
- 日历：`sync_enabled=false` 的课程不出现；只显示平台日历事件；多课程合并为一次请求。
- HTML 清洗：去掉 script/style/事件属性；内部链接改写。
- 凭证：任何响应和日志中都不出现明文。

## 12. 验收
- 添加 Canvas 连接并绑定到 Program 后，在学期向导中能一次性导入本学期全部课程，课程自动关联。
- 作业的截止日期只经导入后的待办出现在日历里，不会出现两次。
- 用假 provider 跑通全部模块测试，证明新增 provider 不需要修改模块代码。

## 实现说明（M09 落地时补充）

> 2026-11-12 的后台同步（§4.1）取代了下面关于 `check_updates`、更新审核、`reported`、`lms.refresh_status`、`lms.complete_submitted` 定时任务、`LmsUpdatesBanner`、`NewAssignmentsToast` 与 `lms.term.new_assignments` 的记载，这些接口和组件已删除；这里保留当时的记录。
以下是实现时做出的取舍与对上文的细化，以代码为准。

**后端**
- 导入流程直接用 M08 的 session，所以 M09 在 M08（#32）之后合并。迁移号 `0013`，在 M08 的 `0012` 之后。
- Provider 方法的第一个参数是 `io`（`providers/base.py` 的 `Io`：共享的安全出站客户端、配置、`truncated` 标记），`normalize_config` 额外接收 `settings`（判断是否允许 http 和私网地址）。Canvas 的文件下载只跟随同源或 Canvas 文件 CDN（`.instructure.com`、`.canvas-user-content.com`、`.inscloudgate.net`、`instructure-uploads.s3.amazonaws.com`）的重定向，令牌只发给同源；每一跳都检查目标地址是否公网。分页只跟随同源的 `Link: rel=next`，最多 50 页，超出时返回 `truncated: true`。
- 凭证以 `v1:<Fernet 密文>` 存在 `credentials_encrypted`，响应里只有 `credentials_hint`（掩码）和 `has_credentials`。新增错误码 `lms.credentials_missing`（409）：数据导入后或密钥轮换后凭证无法解密时出现，界面提示重新填写。`lms.invalid_credentials` 用 400 而不是 401，避免触发前端的"会话已过期"对话框。自托管学校登录（`SEMESTRA_LMS_CANVAS_SIGN_IN`）把 refresh token、client_id/secret、过期时间一并加密存下；`service.fresh` 在临近过期或读路径 401 时续期，结果先放进 `app.state.lms` 的内存，提交后再短事务写回。
- 修改连接的配置（例如地址）时必须重新填写凭证，否则返回 `lms.credentials_missing`：已保存的令牌永远不会发往新地址。令牌格式不对时返回 `lms.invalid_credentials`（reason `format`）。
- 课程导入的 session 提交时，如果学业项目已经换绑到别的连接，课程照常创建，但不建立关联（关联必须使用当前绑定的连接）。
- 定期任务 `lms.refresh_status`（每 6 小时）重新验证连接状态并清理过期缓存：每个连接一个短事务，先问平台、再重新读取该行写状态，期间被删或换了凭证的连接不动；清理缓存单独一个事务。Canvas 公告与日历事件的时间范围都以完整的 UTC 时间传给平台（只传日期时 Canvas 按用户时区的零点算，会漏掉当天零点前的公告）；全天日历事件按平台给的 `all_day_date` 落在 Program 时区的那一天。`set_link` 读外部课程不再写缓存（没有读者）。读缓存在内存 LRU（`app.state.lms`）和表 `lms_cache` 两层，TTL 5 分钟，`refresh=true` 跳过缓存。
- `lms_imported_refs` 多了 `snapshot`（导入时作业的标题、截止时间、分值，以及按作业组推算的实际权重），用于更新检测；`check_updates` 比较的是快照与平台当前值，所以组权重或同组其他作业分值变化也会作为权重更新提示。旧快照没有权重字段时不比较权重。分值变化只在作业组加权的课程里提示（导入不复制分值，未加权课程的分值变化在本地没有可应用的字段）。审核提交时，应用失败的修改项不刷新快照，下次仍会提示。读取平台内容时遇到 `lms.forbidden` 只说明那一项资源没权限，不会把连接标成失效；连接检查（读取本人资料）遇到 403 仍算连接错误。“显示往期课程”时 Canvas 课程列表会额外请求一次 `enrollment_state=completed` 并按 id 去重，因为不带该参数时只返回当前的选课。作业成绩带上 submission 的 `graded_at`。测验列表只含 Classic Quizzes（New Quizzes 是 LTI 作业，暂未识别为测验）；讨论 checkpoint（`type=sub_assignment`）暂不进日历；学期公告卡片仍按课程分别请求，后续可合并成一次多 `context_codes[]` 请求。作业导入或更新审核的 session 未提交期间，课程被取消关联或改关联到另一门平台课程时，提交会整体回滚并返回 `lms.course_not_linked`。
- 导入记录不是订阅 `imports.session.committed` 写的，而是 `register_commit_hook("lms", ...)`：与 M08 提交在同一事务里创建课程关联、写导入记录、刷新快照，提交失败时一起回滚。LMS 侧的对应关系存在 session 的 `source_meta.lms.items`（item id → 外部 id），因为 M08 的 item 数据模型会丢掉未知字段。
- 作业导入按作业组生成 `category` item（`weight_total` 为组权重），考核权重 = 组权重 × 本作业分值占比；课程没开启作业组权重或算不出来时权重为空、置信度为 low，由用户在审核里补。已导入过的作业不再出现在可导入列表里（全部已导入时返回 `import.no_content`）。
- **对 M08 的改动**（M08 规格同步补充）：新 item 类型 `assessment_patch` / `task_patch`（字段级对比，`label` 用于在审核里显示名称），`imports.item.update` 可以传 `type` 在 `assessment` 与 `task` 之间切换（字段按对方的模型转换，切到考核要求有课程；对方没有的字段存进 `held`，切回来时恢复，权重与分类不会丢）。
- 订阅改为 `tasks.item.deleted`（提交后）而不是 `tasks.task.deleting`，因为 M05 发的是这个事件；删除导入记录后同一作业可以再次导入。
- `lms.file.save_to_course` 通过 `importlib` 调 M07 的 `save_bytes_as_file`，M07 还没合并时返回 `lms.feature_unsupported`（feature `save_to_course`）。
- 日历源 `lms.events`：描述只显示纯文本（`meta.note`），"渲染 HTML 描述"开关没有做；`meta.url` 指向平台上的原事件。
- M13 适配器在 `lms/portability.py`（导出连接但不含凭证，导入后状态为 `lms.credentials_missing`；绑定、关联、导入记录按 id 映射；缓存不导出），在文件底部用 M13 的 `register_portability` 注册。

**前端**
- 全局设置"学习平台"组下的"LMS 连接"沿用 AI 服务商分区的列表行样式（`Item` 行 + 行内按钮），没有用表格；手机端仍是对话框，没有做抽屉。删除正在使用的连接时确认框说明会解除多少关联，确认后以 `detach_all=true` 删除。
- 学业项目设置与课程设置的 LMS 分区都在"学习平台"组（`lms`）。更换关联课程前有确认框：旧关联的导入记录会被清除（之后不再检测这些作业的变化）。课程设置里选择外部课程按平台学期分组（当前学期在前），被其它课程关联的项灰显并写明是哪门课程。
- 新扩展点：`lms.providerUi`（本模块定义，`{ kind, label, logo, description?, summary?, ConfigForm, isComplete }`；`description` 是选择服务商时名称下的一行说明，`summary(config)` 给出连接行上除名称外的标识，Canvas 是实例地址）、`academics.courseInfoRows`（课程信息卡片的额外行，用于显示服务商徽章和"在 Canvas 中打开"）（`grading.courseGradesBanners` 随更新提示条在 2026-11-12 删除）。
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
- **学生视角补充（2026-10-22，Canvas 插件评估的优先项与 11/13/15）**：
  - 新 feature：`submissions`、`folders`、`mark_read`（`WRITE_FEATURES`）。新 capability：`lms.submission.get`（`GET .../submissions/self?include[]=submission_comments&include[]=rubric_assessment`：评语、评分标准各项得分、提交次数）、`lms.folder.get`（`/folders/root|:id` 再列子文件夹与文件，`hidden_for_user` 跳过；先按课程路径取一次文件夹，防止读到别的课程的文件夹；`trail` 用 `folders/by_path`）、`lms.file.search`（`/files?search_term=`，只按文件名）、`lms.file.preview`（下载后用 M07 的 `detect`/`parse`，pdf/docx/pptx/xlsx 走隔离进程，按页返回 Markdown，最多 200 页（多读一页判断是否截断），按文件 `updated_at` 缓存，大小上限同上传 `files_max_upload_bytes`，超出报 `lms.file_too_large`）。以上四个开放给 agent/MCP。
  - DTO 补字段：作业 `locked`/`lock_explanation`/`allowed_attempts`/`rubric`；单元 `completed_at`/`prerequisite_module_ids`/`require_sequential_progress`；单元条目 `completion`（`completion_requirement`）/`locked`/`lock_explanation`（取自 `content_details`）/`due_at`/`points`；页面与测验 `lock_explanation`；测验 `time_limit`/`allowed_attempts`/`assignment_id`；submission `attempt`。`lock_explanation` 是 Canvas 的 HTML，转成纯文本。
  - **写操作开关**：账户级设置命名空间 `lms`（`allow_writes`，默认关）。目前唯一的写操作是 `lms.announcement.mark_read`（`PUT /courses/:id/discussion_topics/:id/read`，只开放 HTTP），所有写操作都经 `service.require_write`（先查设置，再查 feature 是否在 `WRITE_FEATURES` 里），关闭时报 `lms.writes_disabled`（409）；成功后删掉该课程公告列表的缓存（改写缓存会把 5 分钟有效期重新计时），前端自己把那条改成已读。单元的"标记完成"没有做。
  - **成绩进更新审核**：导入快照新增 `score`（平台上的 `points_earned/points_possible`）；`check_updates` 对考核比较平台成绩与快照，平台有成绩且成绩册里还没有相同成绩时给出 `score` 变更（旧值是成绩册当前值：有分数时是分数，只有百分比时是 `{score_percentage}`）；成绩册已经有相同成绩时直接把快照推进到这个平台成绩，之后在成绩册里手动改分不会让同一个平台成绩再次出现。导入时已出的成绩随考核一起带入（审核项 `points_earned`/`points_possible`，2026-11-07 起），快照记下这个成绩，不再作为更新提示；导入为待办的项快照 `score` 记为空，审核里改成考核后仍会提示成绩。应用时 M08 把 `score` 展开为 `points_earned`/`points_possible`。不做静默自动同步。
- **模块评审修复（2026-10-23，评审文档 `2026-10-22-模块评审-LMS.md` 的 17 条）**：
  - 缓存（迁移 0021）：`lms_cache` 加 `scope` 列和 `(connection_id, scope)` 索引（升级时清空旧缓存）；`cache.put` 先写内存，库表在 `ctx.after_commit` 里用 `system_ctx` 单独写入（一个请求的所有条目合并成一次事务），失败只记日志。文件下载 / 预览的接口（`file_content`）提交而不是回滚，好让缓存落库。内存 LRU 改用 `cachetools.LRUCache`，按 JSON 大小计，单条超过上限只放第二层。
  - 新 capability `lms.course.refresh`（`POST /courses/{id}/lms:refresh`，只开放 HTTP）：清掉这门课范围内的缓存和日历缓存，之后的读取照常走缓存。Canvas Tab 的"刷新"只调用它一次（见 M16）。
  - `sync_link` 只清 `overview` 和 `course` 两个键，不再清整个连接的缓存。
  - 文件预览缓存 7 天（键里已有文件 `updated_at`，文件变了键也变，所以不挂课程范围，"刷新"不清它）；下载用缓存里的文件元数据（Canvas 下载地址带不过期的 verifier）；`file`、`save_to_course`、`preview` 各只取一次文件元数据，Provider 的 `open_file` 直接收 `FileMeta`。
  - Provider 协议：`announcements(course_ids, since)` 一次取多门课（Canvas 每次最多 10 个 `context_codes[]`），每条带 `external_course_id`；`grades` 改为 `grade_totals`，只返回总成绩（名称 "Course total"），作业行由 `lms.grade.list` 复用作业列表；`modules` 带 `include[]=items&include[]=content_details`，单元里直接有 `items`（太多时 Canvas 不带，前端再按单元取）；分页用 httpx 的 `response.links`。
  - 新 capability `lms.term.announcement.list`（`GET /terms/{id}/lms/announcements`，只开放 HTTP，不可信内容）：学期内所有已关联课程的公告，按连接一次请求，按课程分别缓存，最新的在前；返回 `linked_course_ids` 供卡片区分"没有关联"和"没有公告"。某个连接请求失败时跳过它，其余照常返回；一条都拿不到时报那个错误，卡片显示加载失败。`lms.module_item.list` 先看缓存里的单元列表有没有带这个单元的条目。公告卡片学期作用域用它。
  - `check_updates` 不再在 read capability 的事务里写：推进快照里的 `score` 放到提交后单独写；`preview_apply_updates` 调用时不推进。删除没人读的 `lms_imported_refs.external_updated_at`（M13 适配器不涉及该字段）。
  - 前端查询分两组（`modules/lms/queries.ts`）：`LMS_STATE_QUERIES`（连接、绑定、关联、外部课程、更新检测、概览）和 `LMS_CONTENT_QUERIES`。`invalidateLms(qc, { courseId })` 刷状态组和这门课的内容，`{ all: true }`（改连接）刷全部；SSE 的连接事件刷全部，其余 LMS 事件只刷状态组。立即同步、更新提示条不再调用无参数的 `invalidateQueries()`。
  - 作业导入的发起共用 `lms/import/assignments.ts`（`startAssignmentImport`、`reviewAssignmentImport`），成绩簿的选择器和 Canvas Tab 都用它。
- 课程作业打通第 3 步（2026-11-07，PR #255，迁移 0035）：① 导入记录一对一：唯一键改为 `(link_id, external_kind, external_id)`（迁移删掉同一作业多余的非考核记录）；提交钩子在作业已导入为待办、这次成为考核时把记录改指向考核，已是考核而这次是待办（并发）时以 `lms.assignment_already_imported` 回滚。② `lms.assignment.import` 不再有 `as_kind`，按分值决定；`ImportStarted` 增加 `committed`、`failed`。③ 新增 `lms.assignment.add_to_gradebook`、`lms.term.new_assignments`，`lms.assignment.list` 增加 `new_ids`。④ 日历源 `lms.events` 在前端贡献 `Mark`（平台 logo）与 `OpenLabel`（"在 Canvas 中打开"）。
- Onboarding 步骤 `lms.connect`（2026-11-09，扩展点 `academics.onboardingSteps`，order 200，在学期向导之前）：服务器提供至少一个平台时出现；列出已有连接（“使用”）和可连接的平台（“连接”，打开设置里同一个 `AddConnectionDialog`），选好后绑定到新学业项目，可跳过。`provides` 在学业项目绑定了连接时为 `lms`，学期向导的“从 Canvas 导入课程”声明 `requires: 'lms'`。
- 绑定手动添加的考核（2026-11-10）：① 导入作业时，同名考核（`import.duplicate_assessment` 带 `assessment_id`，即那一项不是从 LMS 导入的）默认绑定：item 的 `existing_assessment_id` 指向它，仍是 accept，issue 换成 `import.binds_assessment`（让审核打开，前端不当问题显示），不计入权重合计；审核"导入到"一列是下拉（绑定到"X" / 作为新考核加入）。M08 提交时只用 `grading.set_source` 给它设 `source_kind/source_ref`，不写别的字段；提交钩子建 `LmsImportedRef`。② 成绩簿行菜单经扩展点 `grading.assessmentActions` 贡献"绑定 {平台} 作业…"（对话框列出未导入的作业）和"解除与 {平台} 的绑定"（确认），capability `lms.assignment.bind`（`PUT /assessments/{id}/lms-assignment`）与 `lms.assignment.unbind`（`DELETE`，导入的考核也能解除；课程已解除关联时只清来源）。③ 绑定时的快照用考核自己的截止时间与权重、成绩记为未见（`imports.bound_snapshot`），所以第一次检查更新会把 Canvas 不同的截止时间、权重、成绩列为变化供审核，绑定本身不覆盖任何值；标题保留平台的，不提议改名。一个考核只能对应一个同类来源（`grading.source_conflict`）。这些差异同时记进 `reported`（`imports.bound_reported`），M18 的后台检查不会把它们当成平台上的变化推送通知。同一次导入里只有一项能绑定到某个考核（校验时第一个绑定它的 item 之外，其他同名项只给不带 `assessment_id` 的 `import.duplicate_assessment`）。
