# 交接：shadcn 全量组件 + Tailwind 检查（2026-10-18）

## 给 M03（[PR #9](https://github.com/jinyuanZhou-Leo/Semestra-Next/pull/9)）和 M04（[PR #12](https://github.com/jinyuanZhou-Leo/Semestra-Next/pull/12)）的 agent：合并 main 后必须改调用方

截至 2026-10-18 13:15，main 已合并 PR #7（`src/ui` 换成 shadcn CLI 生成的 64 个官方组件）和 PR #13（删掉所有薄封装，调用处直接用官方组件）。`claude/m03-jlwq68` 和 `claude/m04-p9u8hm` 都是在这之前开的分支，合并 main 时：

1. **`src/ui/` 整个目录直接取 main 的版本**（`git checkout origin/main -- apps/web/src/ui`），不要手动合并，也不要为了让本分支编译通过去改它。main 的版本就是 CLI 输出；不放心可以在 `apps/web` 跑 `CI=1 pnpm dlx shadcn@latest add --all --overwrite --yes </dev/null`，`git status` 应该没有变化。
2. **改调用方，直接用官方组件，不要重新做封装**（哪怕只是为了少改几个文件或保持接口不变）。以下封装在 main 上已删除：

   | 旧写法 | 改成 |
   |---|---|
   | `AppDialogContent` / `AppSheetContent`、`closeLabel` 参数 | `@/ui/dialog` 的 `DialogContent`、`@/ui/sheet` 的 `SheetContent`；关闭按钮的英文读屏文字 "Close" 接受，不用传 |
   | `TextField` | `Field` + `FieldLabel` + `Input` + `FieldDescription` / `FieldError`（`@/ui/field`、`@/ui/input`），id 用 `useId` |
   | `FormError`、`<p role="alert" className="text-destructive">` | `FieldError` |
   | `SegmentedControl` | `@/ui/toggle-group`：`<ToggleGroup variant="outline" size="sm" value={[v]} onValueChange={(n) => { if (n[0]) set(n[0]) }}>`；测试里查 `button` + `aria-pressed`，不是 `radio` |
   | `RadioCard` / `RadioItem` | `RadioGroup` + `FieldLabel` > `Field orientation="horizontal"` > `FieldContent` + `RadioGroupItem` |
   | `SettingList` / `SettingRow` | `ItemGroup className="gap-0 rounded-2xl border"` + `Item`（`ItemContent` / `ItemTitle` / `ItemDescription` / `ItemActions`）+ `ItemSeparator className="my-0"` |
   | `EmptyState` | `@/ui/empty`：`Empty` / `EmptyHeader` / `EmptyMedia variant="icon"` / `EmptyTitle` / `EmptyDescription` / `EmptyContent` |
   | `ProgressBar` | `@/ui/progress` 的 `Progress`（`ProgressRing` 仍在 `components/Progress.tsx`）；测试查 `aria-valuenow` |
   | `LoaderCircle animate-spin` | `@/ui/spinner` 的 `Spinner` |

   照抄的参考实现都在 main 上：`modules/settings/AppearanceSettings.tsx`（单选卡片、ToggleGroup、Item 行）、`modules/ai/settings/ProviderForm.tsx`（表单字段）、`app/host/ScopePage.tsx`（Empty）、`components/JobProgress.tsx`（Progress）。

3. **两个分支里要改的文件**（只列本分支自己新增或修改的文件；分支从旧 main 带来的其它文件合并 main 后会自动变成新写法）：
   - `claude/m03-jlwq68`：
     - `modules/academics/pages/AllCoursesPage.tsx`：`EmptyState`
     - `modules/grading/cards/ProgramKpisCard.tsx`：`ProgressBar`
     - `modules/grading/components/AssessmentDialog.tsx`：`TextField`、`closeLabel`
     - `modules/grading/components/ManualGrade.tsx`、`PlanPanel.tsx`：`SegmentedControl`
     - `modules/grading/settings/CourseGradingSection.tsx`、`ProgramGradingSection.tsx`：`SegmentedControl`、`SettingList`、`SettingRow`
   - `claude/m04-p9u8hm`：
     - `modules/schedule/cards/TodayCard.tsx`、`UpcomingCard.tsx`、`WeekCard.tsx`、`modules/schedule/pages/CourseSchedulePage.tsx`：`EmptyState`
     - `modules/schedule/components/EventDialog.tsx`、`FeedsDialog.tsx`、`MoveDialog.tsx`、`OccurrenceDetails.tsx`：`closeLabel`
     - `modules/schedule/components/ExportDialog.tsx`、`MeetingDialog.tsx`、`modules/schedule/pages/CalendarPage.tsx`：`SegmentedControl`、`closeLabel`
4. 改完跑 `pnpm typecheck`、`pnpm lint`、`pnpm test`；用到 `SegmentedControl` 的测试要按上表改查询方式。

## 最终状态（先读这里）

- **shadcn 全量组件以 [PR #7](https://github.com/jinyuanZhou-Leo/Semestra-Next/pull/7)（分支 `claude/shadcn-all-components`）为准。** 该 PR 由另一个 agent 基于最新 main 开出；本次在它上面追加了提交 `aec00fe`，并在 PR 里留了[说明评论](https://github.com/jinyuanZhou-Leo/Semestra-Next/pull/7#issuecomment-6245768121)。PR 尚未合并。
- **Tailwind 不需要改动**：所有分支的 `tailwindcss` / `@tailwindcss/vite` 都是 4.3.3（npm 最新），`vite.config.ts` 已挂插件，`src/app/theme.css` 已 `@import 'tailwindcss'`。`shadcn` CLI 4.22.0 也是最新。
- **主工作区（`main` 检出）没有留下本次的代码改动。** 本次一开始在本地 `main` 上做过同样的全量安装，后来发现本地 `main` 比 `origin/main` 落后 24 个提交、且和 PR #7 重复，已全部撤销（`src/ui`、依赖、lockfile、`.ox*rc.json`、auth 组件、M01 规格都恢复原样，`pnpm install --frozen-lockfile` 已重新同步）。主工作区里仍未提交的 `CLAUDE.md`（“UI 相关”一节）和 `docs/specs/M11-设置与偏好.md` 改动属于其他 agent，本次没有动。
- 本地 `main` 仍落后 `origin/main` 24 个提交，本次没有 pull（避免打断其他 agent 的未提交改动）。

## 追加到 PR #7 的提交 `aec00fe`

- `apps/web/src/components/TextField.tsx`：内部改为 `Field` / `FieldLabel` / `FieldDescription` / `FieldError`，对外 props 不变，调用方（auth、academics 共 9 个文件）无需修改。
- `apps/web/src/modules/auth/components/FormError.tsx`：改为渲染 `FieldError`（仍是 `role="alert"`）。
- `apps/web/src/modules/auth/settings/TokensSection.tsx`：两个手写样式的 `<select>`（删掉 `selectClass`）改为 `Field` + `NativeSelect` / `NativeSelectOption`。关闭按钮沿用 PR #7 的 `AppDialogContent`。
- `docs/specs/M01-认证与账户.md` 第 12 节、`CLAUDE.md`：去掉“M01 的 `src/ui` 组件是手写的”过时说明；在 `CLAUDE.md` 的 shadcn CLI 条目里补充：组件已装全、不要再手写同类组件、写死英文的部分用 `AppDialogContent` / `AppSheetContent` 包一层、CLI 生成的三个 hooks/lib 文件视为生成文件。
- 验证（在 PR #7 分支的 worktree 里）：`pnpm typecheck`、`pnpm lint`（只剩一条早已存在的 `AllCoursesPage.tsx` 警告）、`pnpm test`（22 个文件 98 个用例）全部通过。没有做浏览器视觉检查，`Field` 的间距（`gap-3`）比原来手写的 `mb-2` / `mt-1.5` 略大，合并前建议看一眼登录页、`/settings/account` 和学业模块的表单。

## 各分支检查结果（只读）

方法：`git fetch` 后用 `git ls-tree` / `git show` / `git grep` 直接读远程分支，没有切换分支。已合并进 main 的分支（m00、m01、m02、m11、m15、project-thread）内容已包含在 main 里，不单列。

| 分支 | 状态 | `src/ui` 组件数 | 说明 |
|---|---|---|---|
| `origin/main` | — | 19（部分手写） | M01 的 9 个和 M02/M11 加的 `dropdown-menu`、`popover`、`checkbox`、`textarea`、`sheet`、`radio-group` 是手写的 |
| `claude/shadcn-all-components`（PR #7） | 未合并 | 64（全部由 CLI 生成） | 手写版的特殊行为挪到 `src/components/AppDialogContent.tsx`、`AppSheetContent.tsx`、`RadioCard.tsx` |
| `claude/m04-p9u8hm` | 未合并 | 19 | 没改 `src/ui`；前端只有 schedule 查询/工具函数，暂无界面 |
| `claude/m10-2as7nr` | 未合并 | 19 | 没改 `src/ui`；前端只有 manifest 导出，暂无界面 |
| `claude/m14-hvdezf` | 未合并 | 19 | 没改 `src/ui`；插件 UI 全部用 `@/ui` 组件，没有手写控件 |

## 更新（2026-10-18 12:40）：PR #7 冲突已解决

M06（PR #10）合进 main 后 PR #7 出现冲突。已在 PR #7 上合并最新 `origin/main`（提交 `2acfe03`）：

- 唯一的文本冲突是 `apps/web/src/ui/table.tsx`（M06 也手写/格式化了一份，内容相同，只差格式），保留 CLI 生成版。
- M06 的 `apps/web/src/modules/ai/settings/ProvidersSection.tsx` 两处 `DialogContent closeLabel=…` 改为 `AppDialogContent`。
- 本地 web typecheck / lint / 测试（23 个文件 107 个用例）通过；CI 五项（api、web、contract、static、images）全部通过；PR 状态 `MERGEABLE CLEAN`，可以合并。

## 更新（2026-10-18 13:10）：封装组件已全部去掉（最终状态）

- [PR #13](https://github.com/jinyuanZhou-Leo/Semestra-Next/pull/13)（`claude/shadcn-native-cleanup`）：main 上 53 个文件改为直接使用官方组件，删除 `AppDialogContent`、`AppSheetContent`、`RadioCard`、`SegmentedControl`、`EmptyState`、`TextField`、`FormError`、`SettingRow`，`Progress.tsx` 只剩 `ProgressRing`。同时更新了 `CLAUDE.md`（新增“UI 尽量直接用 shadcn 官方组件，不要做薄封装”一条）和 M00/M01 规格。CI 全绿，可合并，**未合并**。
- [PR #11](https://github.com/jinyuanZhou-Leo/Semestra-Next/pull/11)（M10，`b1c608d`）：已合并最新 main，自己的 8 个文件改为官方组件。CI 全绿，可合并。
- [PR #8](https://github.com/jinyuanZhou-Leo/Semestra-Next/pull/8)（M14，`54eeb5b`，**base 是 `claude/m10-2as7nr` 不是 main**，所以没有 CI）：已合并最新 main 和最新 M10，插件设置表单改为官方组件。本地 typecheck / lint / 测试通过。
- 合并顺序建议：#13 → #11 → #8（或 #11 → #13）。#13 和 #11 都改了 `app/host/ScopePage.tsx`、`app/host/StatusBar.tsx`，后合的一方会有文本冲突，两边都已是官方组件，任取一边再跑 typecheck。
- **仍需处理**：`claude/m03-jlwq68`、`claude/m04-p9u8hm` 还在用 `closeLabel` 和已删除的封装，合并 main 后要做同样的转换（参照 CLAUDE.md 新规则）。
- **M14 测试的时区问题**：`plugin-habit-streak/habit.test.tsx` 有 4 个用例在非 UTC 时区（本机 UTC-4）失败，`TZ=UTC` 下通过；CI 用 UTC 所以不受影响。是 M14 原有问题，留给 M14 的 agent。
- `AccountSettings.test.tsx` 的“signing out the current device…”偶发失败（并行负载高时），单独重跑通过。
- 没有在浏览器里做视觉检查：`Field`/`FieldGroup` 间距比原来稍大、设置行描述从 `text-xs` 变为 `text-sm`、强调色色块选中时显示单选圆点而不是对勾、分段控件变成 outline 样式的 `ToggleGroup`。

## 更新（2026-10-18 12:50）：PR #7 已合并，开始去掉封装组件

- PR #7 已合并进 main（`3aa5c3b`）。
- 用户决定：调用处**直接用 shadcn 官方组件，不保留只为维持旧接口的封装**；官方 `Dialog`/`Sheet` 关闭按钮的英文读屏文字 "Close" 接受，不再包一层翻译。
- 要删掉的封装：`AppDialogContent`、`AppSheetContent`、`RadioCard`、`SegmentedControl`（→ `ToggleGroup`）、`EmptyState`（→ `Empty`）、`ProgressBar`（→ `Progress`；`ProgressRing` 保留）、`TextField`（→ `Field` + `Input`）、`FormError`（→ `FieldError`）、`SettingRow`/`SettingList`（→ `Item`）。保留的（有真实行为）：`ConfirmDialog`、`AsyncBoundary`、`JobProgress`、`AiAction`、`AiFieldMark`、`AiRequired`、`HistoryLink`、`EmailField`。
- 新分支 `claude/shadcn-native-cleanup`（基于 main）正在改 main 上的约 40 个文件；同时 `claude/m10-2as7nr`、`claude/m14-hvdezf` 正在合并最新 main 并把各自新增的代码改成官方组件。**这三个分支完成推送前，请不要在 M10/M14 上推送改动**；推送后先 pull。

## 待办 / 给其它 agent 的注意事项

1. **PR #7 合并后，未合并的模块分支会 typecheck 失败（git 不会报冲突）。** PR #7 去掉了手写组件的 `closeLabel` 参数（`DialogContent`、`SheetContent`）和 `RadioItem` 导出。各分支与 main 共有的文件 PR #7 已改好，合并 main 时会带过去；下面是**各分支自己新增**、需要它们自己改的地方（`DialogContent closeLabel=…` → `@/components/AppDialogContent`；`SheetContent closeLabel=…` → `@/components/AppSheetContent`；`RadioItem` → `@/components/RadioCard`）：
   - `claude/m03-jlwq68`：`modules/grading/components/AssessmentDialog.tsx`。
   - `claude/m04-p9u8hm`：`modules/schedule/components/` 下的 `EventDialog`、`ExportDialog`、`FeedsDialog`、`MeetingDialog`、`MoveDialog`、`OccurrenceDetails`；`modules/schedule/pages/CalendarPage.tsx` 的 `SheetContent`。
   - `claude/m10-2as7nr`：`app/board/AddCardDialog.tsx`、`app/board/CardSettingsDialog.tsx`、`app/commands/CommandCenter.tsx`；`modules/plugins/PluginCatalog.tsx` 的 `SheetContent`。
   - `claude/m14-hvdezf`：同 m10 的四个文件（它包含 m10 的改动），外加 `modules/plugin-habit-streak/HabitSettingsForm.tsx`、`modules/plugin-sticky-note/StickySettingsForm.tsx` 的 `RadioItem`。
2. **main 上剩余的手写 UI（已决定：等 PR #7 合并后单独开 PR 处理）。** PR #7 和各模块分支都没动这些：
   - `src/components/Progress.tsx` 的 `ProgressBar`（原生 `<progress>` + 手写样式）→ `@/ui/progress`；`ProgressRing` 官方没有对应组件，保留。
   - `src/components/EmptyState.tsx` → `@/ui/empty`。
   - `src/components/AsyncBoundary.tsx`、`src/app/settings/status.tsx` 的 `LoaderCircle animate-spin` → `@/ui/spinner`（官方 `Spinner` 的 `aria-label="Loading"` 是英文，要传翻译后的 `aria-label`）。
   - 表单错误 `<p role="alert" className="text-destructive">`：`src/app/settings/fields.tsx`、`src/modules/academics/settings/CourseSettings.tsx`、`src/modules/academics/settings/rows.tsx`、`src/modules/academics/wizard/TermWizard.tsx`（两处）→ `FieldError`。
   - `src/components/SegmentedControl.tsx` 可考虑换成 `@/ui/toggle-group`（改之前确认交互语义）。
   - auth 模块里还可细化的：加载态文字 → `Spinner`/`Skeleton`；令牌空状态 → `Empty`；会话/令牌列表和 `SettingsCard.tsx` 的 `Row` → `Item`；`LoginFlow.tsx` 的“或”分隔线 → `FieldSeparator`；`SignInMethodsSection.tsx` 里 `rounded-2xl bg-muted/50 p-4` 的内嵌表单块 → `Card size="sm"` 或 `Item variant="muted"`。
3. `src/ui/` 禁止手改。合并时 `src/ui/` 出现冲突，一律在 `apps/web` 运行 `CI=1 pnpm dlx shadcn@latest add <组件> --overwrite --yes </dev/null`，以 CLI 重新生成的官方版本为准，不要手动合并内容。2026-10-18 核查结果：在 main 上跑 `add --all --overwrite` 没有产生任何改动；PR #13、#11、#8 的 `src/ui/` 与 main 完全一致；`claude/m03-jlwq68`、`claude/m04-p9u8hm` 还是 PR #7 之前的旧 `src/ui/`（62 个文件不同），合并 main 时整个目录直接取 main 的版本（main 的版本就是 CLI 输出）。官方组件里写死的英文读屏文字（如 "Close"）照常接受，不要为它再包一层。PR #13 合并后 Codex 指出 `ItemGroup` 是 `role="list"`，但子元素 `Item`/`ItemSeparator` 不是列表项，读屏器拿不到项目数；这是 shadcn 官方组件的原样行为，用户决定接受，不改。
4. 再跑 `shadcn add --all --overwrite` 会覆盖 `src/hooks/use-mobile.ts`、`src/hooks/use-highlighted-code.ts`、`src/lib/highlighter.tsx`，不要往这几个文件写业务代码。
5. `tooltip` 需要在根部包 `TooltipProvider`；目前没地方用，第一个用的模块请在 `src/routes/__root.tsx` 加上。
6. 开工前先 `git fetch` 并确认本地分支不落后；本次就是因为本地 `main` 过时才和 PR #7 撞车。
