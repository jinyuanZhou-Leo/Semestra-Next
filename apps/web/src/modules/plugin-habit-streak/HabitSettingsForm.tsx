import { useId } from 'react'
import { m } from '@/paraglide/messages'
import { Field, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from '@/ui/item'
import { Label } from '@/ui/label'
import { RadioGroup, RadioGroupItem } from '@/ui/radio-group'
import { Switch } from '@/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import { COLOR_TOKENS, colorVar } from '../plugin-kit/colors'
import { HabitIcon } from './icons'
import { HABIT_ICONS, type HabitSettings } from './schema'

type Props = { value: HabitSettings; onChange: (value: HabitSettings) => void }

const COLOR_NAMES: Record<(typeof COLOR_TOKENS)[number], () => string> = {
  primary: m.habit_color_primary,
  success: m.habit_color_success,
  'subject-1': m.habit_color_subject_1,
  'subject-2': m.habit_color_subject_2,
  'subject-7': m.habit_color_subject_7,
  'subject-9': m.habit_color_subject_9,
  'subject-10': m.habit_color_subject_10,
  'subject-11': m.habit_color_subject_11,
}

/** Settings form of both habit cards (name, icon, goal, color). */
export default function HabitSettingsForm({ value, onChange }: Props) {
  const id = useId()
  const set = (patch: Partial<HabitSettings>) => onChange({ ...value, ...patch })
  return (
    <div className="space-y-4">
      <Field>
        <FieldLabel htmlFor={`${id}-name`}>{m.habit_settings_name_label()}</FieldLabel>
        <Input
          id={`${id}-name`}
          placeholder={m.habit_settings_name_placeholder()}
          maxLength={60}
          value={value.name}
          onChange={(event) => set({ name: event.target.value })}
        />
      </Field>
      <div>
        <p id={`${id}-icon`} className="mb-2 text-sm font-medium">
          {m.habit_settings_icon_label()}
        </p>
        <ToggleGroup
          aria-labelledby={`${id}-icon`}
          variant="outline"
          spacing={1.5}
          value={[value.icon]}
          onValueChange={(next) => {
            if (next[0]) set({ icon: next[0] as HabitSettings['icon'] })
          }}
          className="flex-wrap"
        >
          {HABIT_ICONS.map((name) => (
            <ToggleGroupItem
              key={name}
              value={name}
              aria-label={name}
              className="size-9 rounded-xl px-0 text-muted-foreground aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary"
            >
              <HabitIcon name={name} aria-hidden className="size-4" />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <ItemGroup className="gap-0 rounded-2xl border">
        <Item render={<li />}>
          <ItemContent>
            <ItemTitle>
              <Label id={`${id}-goal`}>{m.habit_settings_goal_label()}</Label>
            </ItemTitle>
          </ItemContent>
          <ItemActions>
            <ToggleGroup
              aria-labelledby={`${id}-goal`}
              variant="outline"
              size="sm"
              value={[value.goal]}
              onValueChange={(next) => {
                if (next[0]) set({ goal: next[0] as HabitSettings['goal'] })
              }}
            >
              <ToggleGroupItem value="daily">
                {m.habit_settings_goal_option_daily()}
              </ToggleGroupItem>
              <ToggleGroupItem value="weekly">
                {m.habit_settings_goal_option_weekly()}
              </ToggleGroupItem>
            </ToggleGroup>
          </ItemActions>
        </Item>
        {value.goal === 'weekly' ? (
          <>
            <ItemSeparator className="my-0" />
            <Item render={<li />}>
              <ItemContent>
                <ItemTitle>
                  <Label id={`${id}-target`} htmlFor={`${id}-target-input`}>
                    {m.habit_settings_weekly_target_label()}
                  </Label>
                </ItemTitle>
              </ItemContent>
              <ItemActions>
                <Input
                  id={`${id}-target-input`}
                  type="number"
                  min={1}
                  max={7}
                  value={value.weekly_target}
                  onChange={(event) => {
                    const n = Math.trunc(Number(event.target.value))
                    if (n >= 1 && n <= 7) set({ weekly_target: n })
                  }}
                  className="w-20"
                />
              </ItemActions>
            </Item>
          </>
        ) : null}
        <ItemSeparator className="my-0" />
        <Item render={<li />}>
          <ItemContent>
            <ItemTitle>
              <Label id={`${id}-toast`}>{m.habit_settings_show_toast_label()}</Label>
            </ItemTitle>
            <ItemDescription>{m.habit_settings_show_toast_description()}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Switch
              aria-labelledby={`${id}-toast`}
              checked={value.show_toast}
              onCheckedChange={(show_toast) => set({ show_toast })}
            />
          </ItemActions>
        </Item>
      </ItemGroup>
      <div>
        <p id={`${id}-color`} className="mb-2 text-sm font-medium">
          {m.habit_settings_color_label()}
        </p>
        <RadioGroup
          aria-labelledby={`${id}-color`}
          value={value.color}
          onValueChange={(color) => set({ color: color as HabitSettings['color'] })}
          className="flex flex-wrap gap-2"
        >
          {COLOR_TOKENS.map((token) => (
            <RadioGroupItem
              key={token}
              value={token}
              aria-label={COLOR_NAMES[token]()}
              title={COLOR_NAMES[token]()}
              className="size-7 rounded-full ring-offset-2 ring-offset-background data-checked:ring-2 data-checked:ring-foreground/60"
              style={{ backgroundColor: colorVar(token) }}
            />
          ))}
        </RadioGroup>
      </div>
    </div>
  )
}
