# ClickStack Design System

ClickStack should feel like a fast, serious homelab/SaaS control panel: clean, modern, low-clutter, and built for people who want to move quickly. The design language is inspired by StackPress, but this file is the global source of truth for ClickStack UI decisions.

## 1. Color System

### Brand Colors

- Primary: `#14B8A6` teal
- Primary Hover: `#0D9488`
- Primary Active: `#0F766E`
- Primary Soft: `rgba(20, 184, 166, 0.12)`
- Primary Border: `rgba(45, 212, 191, 0.28)`

### Secondary Colors

- Slate: `#64748B`
- Cyan Accent: `#38BDF8`
- Indigo Accent: `#818CF8`
- Neutral Accent: `#94A3B8`

Use secondary colors sparingly for charts, subtle accents, icons, or secondary status context. Primary actions should stay teal.

### Dark Theme

- App Background: `#020617`
- Background Gradient Start: `#020617`
- Background Gradient End: `#0F172A`
- Surface: `rgba(15, 23, 42, 0.86)`
- Surface Elevated: `rgba(30, 41, 59, 0.78)`
- Card Background: `rgba(15, 23, 42, 0.72)`
- Muted Background: `rgba(255, 255, 255, 0.04)`
- Border: `rgba(255, 255, 255, 0.10)`
- Strong Border: `rgba(255, 255, 255, 0.16)`
- Text Primary: `#F8FAFC`
- Text Secondary: `#CBD5E1`
- Text Muted: `#94A3B8`
- Text Disabled: `#64748B`

### Light Theme

- App Background: `#F8FAFC`
- Background Gradient Start: `#F8FAFC`
- Background Gradient End: `#E2E8F0`
- Surface: `rgba(255, 255, 255, 0.92)`
- Surface Elevated: `#FFFFFF`
- Card Background: `#FFFFFF`
- Muted Background: `#F1F5F9`
- Border: `rgba(15, 23, 42, 0.10)`
- Strong Border: `rgba(15, 23, 42, 0.16)`
- Text Primary: `#0F172A`
- Text Secondary: `#334155`
- Text Muted: `#64748B`
- Text Disabled: `#94A3B8`

### Status Colors

- Success: `#22C55E`
- Success Soft: `rgba(34, 197, 94, 0.12)`
- Success Border: `rgba(74, 222, 128, 0.28)`
- Warning: `#F59E0B`
- Warning Soft: `rgba(245, 158, 11, 0.14)`
- Warning Border: `rgba(251, 191, 36, 0.30)`
- Error: `#F43F5E`
- Error Soft: `rgba(244, 63, 94, 0.14)`
- Error Border: `rgba(251, 113, 133, 0.30)`
- Info: `#38BDF8`
- Info Soft: `rgba(56, 189, 248, 0.12)`
- Info Border: `rgba(125, 211, 252, 0.28)`

## 2. Typography

### Font Family

- Primary UI Font: `Geist Sans`, `Inter`, `ui-sans-serif`, `system-ui`, `sans-serif`
- Monospace Font: `Geist Mono`, `JetBrains Mono`, `ui-monospace`, `SFMono-Regular`, `monospace`

Use monospace only for paths, IDs, commands, tokens, URLs, timestamps, and technical values.

### Type Scale

- Display: `40px / 48px`, weight `700`
- Page Title: `32px / 40px`, weight `700`
- Section Title: `22px / 30px`, weight `650`
- Card Title: `18px / 26px`, weight `650`
- Body: `15px / 24px`, weight `400`
- Body Small: `14px / 22px`, weight `400`
- Label: `13px / 18px`, weight `600`
- Caption: `12px / 16px`, weight `500`
- Button: `14px / 20px`, weight `650`

### Text Rules

- Headings should be short and direct.
- Body copy should explain what the user can do, not market the product.
- Labels should be clear without being cute.
- Technical values should never truncate unless there is a tooltip or detail view.
- Error text should say what failed and what the user can do next.

## 3. Spacing System

Use a consistent 4px-based spacing scale.

- `1`: `4px`
- `2`: `8px`
- `3`: `12px`
- `4`: `16px`
- `5`: `20px`
- `6`: `24px`
- `8`: `32px`
- `10`: `40px`
- `12`: `48px`
- `16`: `64px`

### Layout Spacing

- Page outer padding: `24px` mobile, `32px` desktop
- Page header bottom margin: `24px`
- Major section gap: `24px`
- Card internal padding: `20px` mobile, `24px` desktop
- Dense card padding: `16px`
- Form field gap: `16px`
- Table cell padding: `12px 16px`
- Modal padding: `24px`

### Rhythm Rules

- Prefer fewer, larger sections over many tiny fragments.
- Keep related controls visually grouped.
- Use whitespace to establish hierarchy before adding borders or colors.
- Avoid cramped three-column forms unless fields are genuinely short.

## 4. Components

### Buttons

All buttons use:

- Height: `40px` default, `48px` for primary form actions
- Radius: `12px`
- Padding: `12px 16px`
- Font: Button style from typography scale
- Transition: `150ms ease`
- Disabled opacity: `50%`

Primary Button:

- Background: Primary
- Text: white or near-white
- Hover: Primary Hover
- Active: Primary Active
- Use for the one main action on a page or form.

Secondary Button:

- Background: muted surface
- Border: standard border
- Text: primary text
- Hover: stronger border and slightly brighter surface
- Use for common actions that are not destructive or final.

Ghost Button:

- Background: transparent
- Border: transparent
- Text: secondary text
- Hover: muted background and primary text
- Use for low-emphasis navigation or utility actions.

Danger Button:

- Background: Error Soft
- Border: Error Border
- Text: light error text in dark mode or dark error text in light mode
- Hover: stronger error surface
- Always pair destructive actions with confirmation.

### Inputs

Text inputs, search fields, dropdowns, and textareas should share the same visual language.

- Height: `42px` for inputs/selects
- Radius: `12px`
- Background: card or elevated surface
- Border: standard border
- Focus: Primary Border plus subtle glow
- Placeholder: muted text
- Error: Error Border and field-level message
- Helper text: caption size, muted text

Rules:

- Long path or URL inputs span full width.
- Password fields should support reveal later, but plain MVP fields are acceptable if scoped to local homelab usage.
- Required fields should be visually marked with `*` and validated inline.

### Cards

Cards are the main dashboard building block.

- Radius: `20px`
- Background: card background
- Border: standard border
- Shadow: subtle only, never heavy
- Padding: `20px` to `24px`
- Header: title plus optional short description

Card types:

- Dashboard Metric Card: one key number, small label, optional trend/status.
- Action Card: short explanation plus one or two actions.
- Detail Card: structured labels and values.
- Warning Card: status color background and clear next step.

### Tables

Tables are for operational data. They should be dense but readable.

- Header text: caption style, uppercase optional only for very small labels
- Row height: minimum `48px`
- Cell padding: `12px 16px`
- Borders: horizontal row dividers only
- Hover: subtle muted background
- Sticky header: allowed for long data views
- Empty state: short explanation plus action button

Rules:

- Status appears near the left, not hidden at the far right.
- Actions appear at the far right.
- Timestamps use consistent formatting.
- Technical filenames/paths use monospace.

### Navigation

Top Navbar:

- Height: `64px`
- Contains product name, current context, global actions, and account/system controls.
- Use on small screens and as a companion to sidebar on large screens.

Sidebar:

- Width: `260px`
- Background: app background or surface
- Border right: standard border
- Active item: Primary Soft background and Primary text/border
- Icons are optional, but labels must remain visible.

Navigation Rules:

- Keep primary nav under 7 items.
- Active state must be obvious.
- Avoid nested navigation unless the product truly needs it.

### Modals

Use modals for confirmation, focused creation flows, and destructive actions.

- Max width: `560px` default, `720px` for complex forms
- Radius: `24px`
- Backdrop: dark translucent overlay
- Header: direct title plus short consequence statement
- Footer: action row with primary/destructive action first, cancel second

Rules:

- Destructive modals must name what will be affected.
- Do not hide important warnings below the fold.
- Escape and close button should dismiss non-destructive modals.

### Badges / Status Indicators

Badges should be compact and instantly scannable.

- Radius: full pill
- Padding: `4px 10px`
- Font: caption, weight `650`
- Success: green
- Warning: amber
- Error: rose
- Info/Running: cyan
- Neutral/Unknown: slate

Common statuses:

- `online`: success
- `down`: error
- `unknown`: neutral
- `running`: info
- `queued`: neutral
- `success`: success
- `success_with_warnings`: warning
- `failed`: error
- `disabled`: neutral

## 5. Layout Rules

### Dashboard Structure

Default dashboard pages should follow this order:

1. Page header with title, subtitle, and primary actions.
2. Metric row or summary cards.
3. Main operational content, usually table plus side panel or detail cards.
4. Recent activity or logs when relevant.

### Page Width

- Default max width: `1440px`
- Form-focused pages: `960px` to `1120px`
- Full data views: full available width with safe padding

### Grid System

- Mobile: single column
- Tablet: two columns where useful
- Desktop: 12-column mental model using CSS grid
- Common dashboard split: `2fr / 1fr`
- Common form grid: two columns with full-width path/textarea fields

### Sidebar vs Top Nav

- Desktop: sidebar plus top header is preferred for power-user dashboards.
- Mobile: collapse sidebar into a menu; top nav remains visible.
- Content should never depend on hover-only sidebar behavior.

## 6. Interaction Rules

### Hover States

- Buttons: stronger fill or border
- Cards: only interactive cards should lift or brighten
- Table rows: subtle row background
- Nav items: muted background and text brightening

### Active States

- Active nav uses Primary Soft background, Primary text, and left border or ring.
- Active filters use Primary Soft background and Primary Border.
- Active tabs must be clear without relying only on color.

### Transitions

- Default transition: `150ms ease`
- Layout transitions: avoid unless they improve clarity
- Loading skeletons: subtle shimmer or static placeholders
- No decorative animation that slows operational tasks

### Loading States

- Buttons show working text, not just spinners.
- Long operations show step text when possible.
- Tables show skeleton rows or a clear loading state.
- Forms should disable duplicate submission while saving.

### Empty States

Empty states should be useful, not cute.

- Say what is missing.
- Explain why it matters.
- Provide the next action.

Example:

`No sites configured yet. Add your first WordPress stack to start running backups.`

## 7. Design Principles

- No fluff. Every visual element must help orientation, action, or confidence.
- Prioritize clarity over novelty.
- Make dangerous actions obvious and reversible when possible.
- Build for power users, not beginners, but never punish non-developers.
- Prefer direct language over clever language.
- Show system state clearly: running, failed, warning, disabled, unknown.
- Technical values should be visible and copyable.
- Pages should feel fast even when operations are slow.
- Use progressive disclosure for advanced settings.
- Keep hierarchy strong: title, summary, action, detail.
- Consistency beats decoration.

## Implementation Notes

When translating this system into Tailwind or CSS variables, define tokens first:

- `--color-primary`
- `--color-bg`
- `--color-surface`
- `--color-card`
- `--color-border`
- `--color-text`
- `--color-muted`
- `--color-success`
- `--color-warning`
- `--color-error`

Reusable UI primitives should include:

- `Button`
- `Input`
- `Select`
- `Textarea`
- `Card`
- `Badge`
- `Modal`
- `Table`
- `PageHeader`
- `SidebarNav`

All future ClickStack UI should follow this file unless a deliberate product-level design decision updates it.
