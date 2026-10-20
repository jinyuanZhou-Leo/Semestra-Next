# M03 成绩与 GPA（Gradebook）

> 依赖：M00、M02、M11、M10（Card 布局，可在 M10 前先用 M00 最小宿主）。被依赖：M04（考核 due 进日历）、M05（考核生成待办）、M08/M09（导入考核与成绩构成）、M12。
> 新版中成绩是**核心模块**（`kind: 'core'`），不再是插件。所有计算只在后端实现。

## 1. 目标与功能对齐
旧版功能（全部保留）：
- 课程成绩簿：考核分类（内置 Quiz/Exam/Assignment/Project/Lab/Presentation/Participation，可自定义名称和颜色、可归档）、考核项（标题、分类、截止日期、权重、百分比得分或"得分/满分"输入）、排序偏好。
- 权重合计必须正好 100% 才进行课程计算，否则提示差额。
- 当前成绩、GPA；**期末成绩覆盖**（官方成绩出来后填写，优先于计算值）。
- 目标 GPA → 剩余考核所需平均分（最低需求）。
- 预测模型：`auto`（按分类历史均值预测剩余考核）与 `simple_minimum_needed`。
- 计划模式（What If）：给未出分的考核填假设分数，实时看结果；"自动填充建议分数"（按分类均值收缩到总体均值，K=3）；目标可在 GPA 与百分比之间切换。
- 学期成绩视图：按学分加权的学期 GPA 与平均分；对未出分课程做 What If。
- 从 LMS 一次性导入作业为考核行（不做持续同步）。
- 考核截止日期出现在日历中。
- GPA 换算表（百分比区间 → 绩点），Program 级默认分类模板与预测模型默认值。
- Program 概览 KPI 与按学期的 GPA/学分图表；全部课程表格的成绩/GPA 列和筛选；`hide_gpa`（隐藏 GPA 显示）。
- 成绩簿小部件（学期/课程的学分、GPA、GPA 百分比）。

新版变化：
- 没有成绩簿的课程也能直接填写最终成绩（旧版 `course.grade_percentage`）；有成绩簿时最终成绩来自成绩簿或覆盖值。
- 年课只有一个最终成绩，GPA 只计一次，默认计入课程的**结束学期**（Program 设置可改为"按学期平分学分"）。
- 支持 Pass/Fail 课程（不计入 GPA，但计入已获学分）。
- 字母等级可选：换算表每档可带字母（A+、A…），用于显示。

## 2. 领域模型
```
grading_scales                       # 每个 Program 一张换算表
  id, user_id, program_id (unique),
  bands JSON [{min: 85, max: 100, points: 4.0, letter?: "A"}],  # 区间闭合 [min, max]，按 min 降序
  max_points (float, 默认 4.0),
  year_course_attribution ('end_term' | 'split_evenly', 默认 'end_term'),
  default_forecast_model ('auto' | 'simple_minimum_needed'),
  default_categories JSON [{key, name, color}],
  hide_gpa (bool, 默认 false),
  updated_at

grading_course_results               # 每门课一行（创建课程时懒创建）
  course_id (PK), user_id,
  basis ('percentage' | 'pass_fail', 默认 'percentage'),
  manual_percentage? (float, 无成绩簿时使用),
  final_override_percentage? (float, 有成绩簿时的官方成绩),
  pass_fail_result? ('pass' | 'fail'),
  target_points? (float, 目标绩点, 默认 = scale.max_points),
  forecast_model ('auto' | 'simple_minimum_needed'),
  gradebook_enabled (bool, 默认 true),
  updated_at

grading_categories
  id, user_id, course_id, key, name, color (token 名或 hex), position, archived (bool)
  UNIQUE(course_id, key)

grading_assessments
  id, user_id, course_id, category_id? (ON DELETE SET NULL),
  title, due_at? (datetime, UTC；只有日期时存当天 23:59 本地时间转 UTC 并标记 due_has_time=false),
  due_has_time (bool), weight (float, 百分比 0-100),
  score_percentage? (float 0-100+，允许加分超过 100),
  points_earned?, points_possible?,     # 二者都有时 score_percentage 由服务端计算并存储（输入派生，不是汇总派生）
  dropped (bool, 默认 false，用于"最低分不计"手动标记), note?,
  source_kind? ('lms' | 'syllabus' | 'manual'), source_ref?,  UNIQUE(course_id, source_kind, source_ref)
  position, created_at, updated_at
```
内置分类：Quiz(blue)、Exam(amber)、Assignment(emerald)、Project(violet)、Lab(cyan)、Presentation(rose)、Participation(slate)。新课程按 `scale.default_categories` 初始化；Program 创建时 `default_categories` = 内置列表。

预设换算表（Program 创建时可选，M02 onboarding 扩展点 `academics.programSetupFields`）：
- `uoft_4_0`（旧版默认表：90-100→4.0、85-89→4.0、80-84→3.7、77-79→3.3、73-76→3.0、70-72→2.7、67-69→2.3、63-66→2.0、60-62→1.7、57-59→1.3、53-56→1.0、50-52→0.7、0-49→0.0，带字母 A+ A A- B+ B B- C+ C C- D+ D D- F）
- `us_4_0`（A 93+ 4.0、A- 90 3.7、B+ 87 3.3…）
- `cn_100`（百分制直接显示，绩点 = 常见 4.0 映射：90-100→4.0、85-89→3.7、82-84→3.3、78-81→3.0、75-77→2.7、72-74→2.3、68-71→2.0、64-67→1.5、60-63→1.0、0-59→0）
- `custom`（从空表开始）

## 3. 计算规则（`grading/engine.py`，纯函数，100% 单元测试覆盖）
记号：考核 i 的权重 wᵢ、得分 sᵢ（未出分为空），`dropped` 的考核不参与任何计算。
1. **权重完整性**：Σwᵢ（未 dropped）必须在 100 ± 0.01 之内，否则课程计算结果全部为空，并返回 `weight_total` 与 `weight_gap`。
2. **当前得分贡献** C = Σ(wᵢ·sᵢ)/100（已出分项）；已出分权重 W_g = Σwᵢ（已出分）。
3. **当前百分比**（"目前为止的表现"）P_now = C / W_g × 100（W_g=0 时为空）。另提供"已锁定贡献"C 本身（即剩余全拿 0 分时的最终成绩）。
4. **最终百分比**：有 `final_override_percentage` → 使用它；否则无剩余考核 → C；否则为空（未完结）。
5. **预测**：
   - `auto`：剩余考核 j 的预测分 = 所在分类已出分项按权重的均值；如果某个剩余考核的分类没有历史，预测为空并返回 `missing_history_categories`。预测最终 = C + Σ(wⱼ·predⱼ)/100。
   - `simple_minimum_needed`：不预测，只给最低需求。
6. **最低需求平均分** R = (T − C) / W_r × 100，T 为目标绩点对应的最低百分比（换算表中 points ≥ target 的最低 min），W_r 为剩余权重；R ≤ 0 返回 0；W_r = 0 时若 C ≥ T 返回 0 否则不可达（`reachable=false`）；R > 100 返回值并标记 `reachable=false`。
7. **建议分数（What If 自动填充）**：对每个剩余考核，基准 = 收缩均值 `(n·mean_cat + K·mean_all)/(n+K)`，K=3；然后整体平移使最终成绩恰好达到目标 T（不足时向上取整到 0.5，最高 100）。
8. **百分比 → 绩点**：找到包含该百分比的区间（区间按 [min, max]，相邻整数区间视为连续，即 84.6 落在 80-84 与 85-89 之间时按 `≥ 85` 判断：实现为"取 min ≤ p 的最高档"）。
9. **课程有效成绩**（供学期/Program 汇总）：
   - `pass_fail`：不计入 GPA；`pass` 计入已获学分。
   - 有成绩簿：最终百分比（第 4 条）；未完结时为"进行中"，汇总时可选择包含进行中课程的当前百分比（`include_in_progress` 参数，默认不包含）。
   - 无成绩簿：`manual_percentage`。
10. **学期 GPA** = Σ(绩点ᵢ × 学分ᵢ)/Σ学分ᵢ，仅计入 `include_in_gpa=true`、学分>0、有有效成绩的课程；平均百分比同理加权。年课：`end_term` 规则下只计入结束学期；`split_evenly` 规则下学分按关联学期数平分计入每个学期。
11. **累计 GPA（Program）**：所有课程按第 10 条规则合计，每门课只计一次。已获学分 = 有效成绩对应绩点 > 0 或 pass 的课程学分合计；与 `credit_requirement` 比较得出进度。
12. **学期 What If**：给未出最终成绩的课程填假设百分比，返回预测学期 GPA、平均分；可设学期目标 GPA，返回是否可达与差额。

所有结果数值保留 3 位小数，显示层再格式化。

## 4. Capabilities
| name | effect | http | 说明 |
|---|---|---|---|
| `grading.scale.get` | read | GET /programs/{program_id}/grading-scale | |
| `grading.scale.update` | write | PUT /programs/{program_id}/grading-scale | 校验区间不重叠、覆盖 0-100、points ≤ max_points、分数越高绩点不会更低 |
| `grading.scale.list_presets` | read | GET /grading/scale-presets | |
| `grading.gradebook.get` | read | GET /courses/{course_id}/gradebook | 分类、考核、course_result、**计算摘要**（第 3 节全部指标） |
| `grading.course_result.update` | write | PATCH /courses/{course_id}/grade | basis、manual、override、pass_fail、target、forecast_model、gradebook_enabled |
| `grading.category.create/update/delete/reorder` | write | /courses/{course_id}/grading-categories... | 删除分类时其考核变为未分类 |
| `grading.assessment.list` | read | GET /courses/{course_id}/assessments | 支持 `fields`、`status=graded|pending|overdue` |
| `grading.assessment.create` | write | POST /courses/{course_id}/assessments | |
| `grading.assessment.create_many` | write | POST /courses/{course_id}/assessments:batch | 导入用，按 `source_kind+source_ref` 去重（已存在则跳过并在结果中列出） |
| `grading.assessment.update` | write | PATCH /assessments/{assessment_id} | 记录分数主要用这个 |
| `grading.assessment.delete` | destructive | DELETE /assessments/{assessment_id} | |
| `grading.assessment.reorder` | write | PUT /courses/{course_id}/assessment-order | |
| `grading.assessment.find` | read | （agent/mcp） | 按课程 + 标题模糊查找（"Lab 3"、"期中"），跨课程查找时按 scope 优先 |
| `grading.simulate.course` | read | POST /courses/{course_id}/gradebook:simulate | 输入 what-if 分数表与目标，返回摘要；计划模式每次改动调用（前端 200ms 防抖） |
| `grading.score.suggest` | read | POST /courses/{course_id}/gradebook:suggest | 第 3 节第 7 条 |
| `grading.summary.term` | read | GET /terms/{term_id}/grade-summary | 学期 GPA、平均分、学分、每门课有效成绩与绩点 |
| `grading.simulate.term` | read | POST /terms/{term_id}/grade-summary:simulate | 学期 What If |
| `grading.summary.program` | read | GET /programs/{program_id}/grade-summary | 累计 GPA、已获学分、进度、按学期序列（图表用） |
| `grading.course_summary.list` | read | GET /programs/{program_id}/course-grades | 每门课的有效成绩、绩点、字母、状态（全部课程表格用） |

事件：`grading.assessment.created|updated|deleted`（payload 含 course_id、due_at 变化标记，M04/M05 订阅）、`grading.course_result.updated`、`grading.scale.updated`。
订阅：`academics.course.created` → 创建 course_result 与默认分类；`academics.course.deleting` → 删除本模块数据；`academics.program.created` → 按选择的预设创建 scale（默认 `uoft_4_0`）。
前端失效：`grading.*` → `gradingGradebook*`、`gradingSummary*`、`gradingCourseSummaryList*`。

## 5. 前端
### 5.1 课程 Page `grades`（课程作用域）
- 顶部摘要条：最终/当前百分比与 GPA（字母）、权重合计（不足 100 时警告条显示差额，计算指标显示"—"）、目标绩点与所需平均分、预测值（auto 模式）、"录入官方成绩"按钮（覆盖值，显示"已覆盖"标记，可清除）。
- 考核表格（TanStack Table）：分类徽章、标题、截止（相对时间 + 逾期高亮）、权重、得分（单元格内联编辑；输入 `18/20` 自动识别为分数制）、操作菜单。支持按截止/分类/权重/标题排序（偏好存 `useUiPref('grading.sort')`），按分类分组折叠。
- 添加考核：行内快速添加（标题 + 回车，默认分类与权重 0）+ 完整对话框；"从…导入"菜单列出扩展点 **`grading.assessmentImportSources`**（M09 贡献 LMS 作业，M08 贡献 syllabus 成绩构成）。
- **计划模式**开关：未出分的考核得分列变为假设输入（不同底色），顶部显示预测结果与目标达成情况；"自动填充"调用 `grading.score.suggest`；目标输入可切换"绩点/百分比"；假设分数存 `useUiPref('grading.whatif.<courseId>')`。
- 课程设置分区（course 级）："成绩"：计分方式（百分比/Pass-Fail）、是否使用成绩簿（关闭则只填最终成绩）、预测模型、分类管理（增删改名、颜色、归档、排序）。

### 5.2 学期 Page `grades`（学期作用域）
- 表格：每门课 code/title、学分、计入 GPA、状态（进行中/已完成/Pass）、百分比、绩点/字母；点击课程跳到该课程 `grades` Page。
- 汇总：学期 GPA、平均分、计入学分、排除课程数。
- 学期 What If：对进行中课程填假设百分比，可设学期目标 GPA，显示是否可达与差额。

### 5.3 Cards
- `grading.courseSummary`（course，s/m）：当前/最终成绩、GPA、所需平均分、下一个截止考核。
- `grading.termSummary`（term，s/m）：学期 GPA、学分、课程数。
- `grading.programKpis`（program，xl）：累计 GPA、平均分、已获学分/要求学分进度条、学期数。
- `grading.programCharts`（program，l/xl）：按学期的 GPA 折线（含累计 GPA 线）与学分柱状图。图表配色使用 `--chart-*` token。
- `grading.upcoming`（term/course，m/l）：即将截止的考核列表。
- `hide_gpa=true` 时所有显示 GPA 的位置改为显示"•••"，可点击临时显示。

### 5.4 扩展贡献
- `academics.courseColumns`：成绩（百分比/字母）、GPA（`showInTermCard=true`），以及筛选器 GPA=满分、≥3.5、≥3.0（阈值随 `max_points` 缩放）。
- `academics.programSetupFields`：GPA 换算预设选择。
- M04 日历源：考核截止事件（见 M04 的 `CalendarSourceContribution`），颜色取课程颜色，点击打开课程 `grades` Page 并高亮该行。
- Program 设置分区（program 级）："GPA 与成绩"：换算表编辑器（可视化区间条 + 表格编辑 + 预设重置）、年课计入规则、默认分类模板、默认预测模型、隐藏 GPA。

## 6. Agent 集成
- 全部 capability 暴露；读操作返回值必须精简（摘要字段可选）。
- Skills：
  - `record-grades.md`：用户说"我期中考了 82"时的流程：`academics.course.find` → `grading.assessment.find` → 找不到时询问是否新建 → `grading.assessment.update`。说明分数制输入（"18/20"）的处理。
  - `grade-planning.md`：回答"我期末要考多少才能拿 A"：`grading.gradebook.get` 读最低需求；需要假设时用 `grading.simulate.course`；**不要**为了模拟去修改真实分数。
  - `setup-gradebook.md`：根据 syllabus 的成绩构成建分类和考核（与 M08 的抽取结果配合），检查权重合计 100。

## 7. 错误码
`grading.scale_invalid`（params: reason）、`grading.weights_not_100`（仅在需要完整权重的 simulate/suggest 中作为错误返回；gradebook.get 中以字段表示）、`grading.points_invalid`（满分 ≤ 0 或得分为负）、`grading.category_key_conflict`。

## 8. 测试
- 引擎：每条规则的单元测试 + hypothesis 性质测试（权重 100 时最终成绩 ∈ [0, max]、override 优先、dropped 不影响、split_evenly 下每门课总学分不变）。
- 换算表：边界值（84.6、85、89.99、100、0）、字母映射、区间校验错误。
- 年课在两种规则下的学期 GPA 与累计 GPA（只计一次）。
- 导入去重：重复导入同一 LMS 作业不产生重复行。
- 前端：计划模式输入后摘要更新、权重不足警告、`18/20` 解析、hide_gpa 遮罩。

## 9. 验收
- 用户能在 1 分钟内为一门课建好成绩构成并录入分数，看到当前成绩与达标所需分数。
- 学期页与 Program 概览的 GPA 与手工计算一致（附测试数据集 `tests/fixtures/grading_cases.json`）。


## 实现说明（M03 落地时补充）
以下是实现时做出的取舍与对上文的细化，以代码为准。

**后端**（`apps/api/src/semestra/modules/grading/`）
- 计算全部在 `engine.py`（纯函数 + dataclass，结果四舍五入到 3 位小数）：换算表校验与查表、`compute_course`（第 3 节规则 1–6）、`suggest_scores`（整体平移二分 + 向上取 0.5 + K=3 收缩）、年课学分归属、学期/Program 汇总与序列、学期 What If。`service.py` 只负责读库、组装与事件。
- 表 `grading_scales`（每个 Program 一行）、`grading_course_results`（主键 `course_id`）、`grading_categories`、`grading_assessments`；跨模块的 id 都是普通字符串，不建外键，清理靠订阅 `academics.course.deleting` / `academics.program.deleting`（同事务）。分类删除时考核的 `category_id` 置空。
- 预设 `uoft_4_0`、`us_4_0`、`cn_100`、`custom`；`custom` 起点只有一个 0–100 的单区间，由用户自己拆分。预设与默认分类模板的文本都在 `presets.py`，分类颜色是名称（blue、amber、emerald、violet、cyan、rose、slate）或 `#rrggbb`，前端把名称映射到主题的科目色令牌。
- 考核的截止时间输入除 `due_at` 外还接受 `due_date` + `due_time`（按 Program 时区解释，没有时间则只显示日期、截止点是当天结束）；输出同时给 `due_at` 和本地的 `due_date`/`due_time`，前端表单直接用后者。
- 分数输入：`points_earned` + `points_possible` 优先并换算出百分比；只给 `score_percentage` 会清除分数制；`points_earned: null` 清除分数。`status` 由服务端算出（`graded` / `pending` / `overdue`）。
- 事件：除第 4 节列出的三类外，删除考核前在事务内发 `grading.assessment.deleting`；`created|updated` 的 payload 带 `changed`（变化的字段名），`deleted` 带 `due_changed`。分类的增删改没有事件（本标签页靠失效刷新，其它标签页要等下一次拉取）。
- `assessment_deadlines()`（`service.py`）给 M04 用：返回某时间范围内尚未出分的考核截止点。日历源 `grading.assessments` 在 `grading/calendar.py` 注册（只有日期的截止点显示为当天的全天项，有时间的是一个时间点；考核增删改后发 `calendar.changed`），前端在 `grading/manifest.ts` 的 `calendarSources` 里，点击打开课程的 `grades` Page。高亮对应行还没做。
- 官方成绩覆盖（`final_override_percentage`）即使权重不足 100 也生效（用户已经知道最终成绩）；此时不给 `required_average` 与 `reachable`。`include_in_gpa=false` 的课程不进 GPA，但已完成的学分仍计入"已获学分"。
- 错误码 `grading.scale_invalid` 的 `reason` 为 `empty`、`range_invalid`、`overlap`、`not_monotonic`、`not_from_zero`、`not_to_hundred`、`points_out_of_range`、`max_points_invalid`、`category_key_duplicate`；`grading.points_invalid` 的 `reason` 为 `points_possible_missing`、`above_scale_maximum`。前端对每个码只给一条文案，不按 reason 细分。

**前端**（`apps/web/src/modules/grading/`）
- 页面 `grades`（`pages/GradesPage.tsx` 按作用域分发到课程页 / 学期页）；卡片 `grading.courseSummary`、`termSummary`、`programKpis`、`programCharts`（纯 SVG，颜色用 `--chart-*`）、`upcoming`；设置分区 `program-grading`（换算表编辑器、预设重置、年课规则、默认预测模型、隐藏 GPA、默认分类）与 `course-grading`（计分方式、是否用成绩簿、预测模型、分类管理）。
- 考核表与学期课程表都用 TanStack Table v9。**列定义必须放在组件外**（单元格里是会输入的 `InlineInput`，列在渲染时重新创建会让单元格每次渲染都被重新挂载、丢掉正在输入的内容），单元格需要的回调通过 context 传入。
- 分数单元格输入 `82` / `82%` 为百分比，`18/20` 为分数制（`score.ts` 的 `parseScore`），空为清除，无法识别时标红不发送。
- 计划模式：假设分数存 `useUiPref('grading.whatif', …, { scope: courseId })`，只保留仍未出分的考核；200ms 防抖调用 `grading.simulate.course`，结果只显示不保存；目标默认用课程自己的目标，可单独切换"绩点/百分比"；"自动填充"调用 `grading.score.suggest` 并把结果写进假设分数。权重不足 100 时计划模式不可用（服务端也会拒绝）。学期 What If 同理（`grading.term.whatif`，按学期保存）。
- 课程成绩页布局（UI/UX 第五轮重新设计，替代 5.1 的"顶部摘要条"）：左边是考核表（工具栏是表格卡片的标题栏："考核 N" + 操作按钮），右边一列（窄屏移到表格上方）是"成绩构成"卡（环形图按分类权重分段，已出分部分实心；中间是当前/最终百分比，旁边是 GPA 与预测；下面每个分类一行，悬停环与行互相高亮并显示分类明细）和"目标"卡（目标绩点内联编辑 + 剩余部分所需平均分）。"录入官方成绩"放进工具栏的 ⋯ 菜单（对话框），清除也在菜单里（可撤销的 toast）；成绩构成的图例行可用键盘聚焦，明细同时作为提示和读屏描述；按分类分组是工具栏的开关，分组标题行显示该组权重与平均分；行内快速添加在表格最后一行。
- 计划模式原地切换，不再有单独的面板：标题栏整行换成"规划中"+ 说明 +「清空假设」（可撤销的 toast，不弹确认）+「退出规划」（都是 destructive）；撤销清空只恢复假设分数，不动目标和规划状态；规划时不显示真实预测，分组行的平均标为「实际」；成绩构成卡显示模拟结果（环上假设部分用半透明，中间显示规划值和实际值）；目标卡换成本次规划的目标（不保存，可切换绩点/百分比，可回到课程目标）和"自动填充"。
- `hide_gpa`：所有 GPA 数字通过 `GpaValue` 显示，开启时显示"•••"，点击后临时显示。
- 内置分类名（Quiz、Exam…）没改过名时按界面语言显示；改过名就显示用户的名字。
- 新增扩展点 **`grading.assessmentImportSources`**（`types.ts`）：`{ id, title, icon, launch({programId, courseId}) → AssessmentDraft[] }`，成绩页的"从…导入"菜单列出所有贡献，选择后调用 `create_many`（按 `source_kind` + `source_ref` 去重）。目前没有贡献者，菜单不显示；M09、M08 落地时贡献。
- 对 M02 契约的补充：`academics.courseColumns` 的 `CourseColumn` 多了可选的 `query(programId)`，列需要别的模块的数据时（成绩、GPA）由全部课程表与学期课程卡片统一用 `useQueries` 加载，结果作为第二个参数 `data` 传给 `cell`、`sortValue` 和筛选器的 `test`。GPA 筛选器（满分、≥3.5、≥3.0）的阈值按 `max_points / 4` 缩放。
- UI 全部直接用 `@/ui/*` 的 shadcn 官方组件（`Field`、`Item`、`ToggleGroup`、`Progress`、`Table` 等），不再有手写副本；设置分区里的 `SettingRow`（`grading/settings/rows.tsx`）只是 `Item` 的模块内组合。
- 前端测试：`score.test.ts`（输入解析）、`sort.test.ts`、`grading.test.tsx`（摘要、权重警告、`18/20` 保存为分数制、非法输入不发送、计划模式摘要更新且不保存、`hide_gpa` 遮罩）。
