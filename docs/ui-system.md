# Atlas UI System

## Color Usage
- `background`: default application canvas. Keep it dark and neutral.
- `card` and `popover`: elevated surfaces for shell panels, overlays, and contextual actions.
- `primary`: cyan. Use for primary actions, active navigation, high-confidence forward actions.
- `secondary`: subdued neutral action surface for standard controls.
- `muted`: supporting surfaces, dense utility rows, and quiet containers.
- `destructive`: red. Use only for destructive actions or blocking errors.
- `success`: emerald. Use for positive completion, healthy state, and approved outcomes.
- `warning`: amber. Use for review-needed, impersonation, caution, or pending attention.

Do not introduce additional accent colors in product UI without a specific system update.

## Spacing Rules
- Page chrome: `px-4 py-5` on small screens, scaling to `px-8` on large screens.
- Shell groups: use `gap-3` for compact action bars and `gap-4` to `gap-6` for larger sections.
- Cards: default to `p-6`.
- Dense metadata rows: default to `px-4 py-3` or `px-4 py-4`.

## Typography Hierarchy
- App identity and major section titles: semibold with tight tracking.
- Numeric finance values: larger size, strong weight, minimal decorative treatment.
- Supporting labels and timestamps: `text-sm` or `text-xs` with `muted-foreground`.
- Status indicators: uppercase badge treatment with compact spacing.

## Approved Core Components
- `Button`
- `Input`
- `Textarea`
- `Label`
- `Card`
- `Badge`
- `Table`
- `Dialog`
- `Sheet`
- `Select`
- `Tabs`
- `DropdownMenu`
- `Separator`
- `Skeleton`
- `Form`
- `Sonner`

Outside the app shell, do not replace existing product-specific UI with these components in this pass unless required strictly for compilation.

## Interaction Rules
- Primary action should appear once per local action group.
- Secondary actions should use outline or neutral surfaces.
- Focus states must use the shared ring token.
- Hover states should improve clarity, not add decorative motion.
- Dialogs and sheets should be used for shell or administrative context, not to rework product workflows in this pass.

## Atlas Visual Priority
- `payment`: highest visual emphasis among financial values. Use larger type and strong contrast.
- `down`: secondary emphasis to payment, still prominent when displayed with financing outcomes.
- `status`: compact and scannable. Prefer badges or short labeled chips.
- `next action`: clear primary button placement, especially in header and queue contexts.

The product should read like a serious underwriting platform: fast to scan, contrast-forward, and operational rather than decorative.
