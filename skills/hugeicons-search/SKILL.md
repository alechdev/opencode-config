---
name: hugeicons-search
description: >
  Find and use the correct Hugeicons icon export names in React projects.
  Use whenever the project has @hugeicons/* or @hugeicons-pro/*, when adding or
  swapping UI icons, when a Lucide/shadcn icon name is guessed wrong, when an
  import from @hugeicons/core-free-icons or @hugeicons-pro/* fails, or when the
  user asks for an icon (trash, close, settings, cart, etc.). Prefer this over
  inventing names — Hugeicons names often differ from Lucide (Delete01Icon not
  Trash2, Cancel01Icon not X, Add01Icon not Plus, Logout01Icon not LogOut).
---

# Hugeicons icon search (React)

Hugeicons names look familiar but diverge from Lucide/shadcn. **Never invent an
export name.** Resolve the installed package, search it, then copy an exact
match into the import.

## 1. Detect which icon package to use

Read `package.json` (or neighboring imports):

| Installed dependency | Import icons from |
| --- | --- |
| `@hugeicons/core-free-icons` | `@hugeicons/core-free-icons` |
| `@hugeicons-pro/core-stroke-rounded` (or other `core-*`) | that exact pro package |

Renderer is always separate:

```ts
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon } from "@hugeicons/core-free-icons"; // or @hugeicons-pro/core-...
```

If both free and pro are present, match the package already used in nearby
files. Default to free unless the file/project already imports pro.

Pro style packages (same export *names*, different look):

- stroke: `core-stroke-rounded`, `core-stroke-standard`, `core-stroke-sharp`
- solid: `core-solid-rounded`, `core-solid-standard`, `core-solid-sharp`
- multi: `core-bulk-rounded`, `core-duotone-rounded`, `core-duotone-standard`, `core-twotone-rounded`

## 2. Search — do not guess

Search the **installed package** in the project. Expand Lucide-ish synonyms
first (see map below), then list matching export files.

```bash
# Resolve package root (works with pnpm/npm/yarn)
node -e "console.log(require('path').dirname(require.resolve('@hugeicons/core-free-icons/package.json')))"
# pro example:
# node -e "console.log(require('path').dirname(require.resolve('@hugeicons-pro/core-stroke-rounded/package.json')))"

# Then search export filenames (strip .js → export name)
ls "$(node -e "process.stdout.write(require('path').dirname(require.resolve('@hugeicons/core-free-icons/package.json')))")/dist/esm" \
  | rg -i 'delete|remove' | rg 'Icon\.js$' | head -40
```

Also check how the codebase already names icons for the same intent:

```bash
rg "from \"@hugeicons" -g'*.{ts,tsx}' -n | head -40
rg "Delete0|Cancel0|Settings0" -g'*.{ts,tsx}' -n
```

`Delete02Icon.js` → export `Delete02Icon`. Copy the name exactly.

## 3. Naming rules (why Lucide muscle-memory fails)

Exports are **PascalCase + `Icon` suffix**.

| Pattern | Rule | Examples |
| --- | --- | --- |
| Numbered variants | Many concepts ship as `01`/`02`/`03`… Prefer the variant already used in the codebase | `Home01Icon`, `Settings02Icon`, `File02Icon` |
| No Lucide `2` suffix | Lucide `Trash2` / `User2` ≠ Hugeicons | `Delete02Icon`, `User02Icon` |
| Compound words stay glued | Not kebab-case in JS | `ShoppingCart01Icon`, `ArrowUpRight01Icon` |
| Spelled numbers | Digits in the *concept* become words | `FirstBracketIcon`, `ThreeDViewIcon` |
| Log in/out | One word, not `LogOut` | `Login01Icon`, `Logout01Icon` |
| Plus / X / trash | Different roots than Lucide | `Add01Icon` / `PlusSignIcon`, `Cancel01Icon` / `MultiplicationSignIcon`, `Delete01Icon` (no `TrashIcon` in free) |

### Lucide → Hugeicons quick map

Use as **search seeds**, then confirm against `dist/esm`:

| Intent (Lucide-ish) | Search terms / typical exports |
| --- | --- |
| `Plus` | `add`, `plus-sign` → `Add01Icon`, `PlusSignIcon` |
| `X` / `XIcon` | `cancel`, `multiplication`, `cross` → `Cancel01Icon`, `MultiplicationSignIcon` |
| `Trash` / `Trash2` | `delete`, `remove` → `Delete01Icon`–`Delete04Icon` |
| `Check` | `check`, `tick`, `checkmark` → `CheckIcon`, `CheckmarkCircle01Icon` |
| `ChevronDown` | `chevron-down` → often exact `ChevronDownIcon` |
| `MoreHorizontal` | `more`, `ellipsis` → `MoreHorizontalIcon`, `More01Icon` |
| `LogOut` / `LogIn` | `logout`, `login` → `Logout01Icon`, `Login01Icon` |
| `Settings` | `settings`, `cog` → `Settings01Icon`, `Settings02Icon` |
| `Home` | `home` → `Home01Icon` |
| `User` / `Users` | `user`, `user-group` → `User02Icon`, `UserGroupIcon` |
| `Search` | `search` → `Search01Icon` |
| `Bell` | `notification`, `bell` → `Notification01Icon`, `BellIcon` |
| `Mail` | `mail` → `Mail01Icon` |
| `ShoppingCart` | `cart`, `shopping` → `ShoppingCart01Icon`, `ShoppingBag01Icon` |
| `ExternalLink` | `external`, `link-square`, `arrow-up-right` → `LinkSquare01Icon`, `ExternalLinkIcon` |
| `Loader2` | `loading` → `Loading01Icon`, `Loading02Icon` |
| `RefreshCw` | `refresh`, `reload` → `Refresh01Icon`, `ArrowReloadHorizontalIcon` |
| `GripVertical` | `drag`, `grip` → `Drag01Icon`, `GripVerticalIcon` |
| `PanelLeft` | `sidebar`, `panel` → `SidebarLeftIcon`, `PanelLeftIcon` |
| `Info` | `information` → `InformationCircleIcon` |
| `AlertCircle` | `alert` → `AlertCircleIcon`, `Alert01Icon` |
| `EyeOff` | `eye`, `view` → `EyeOffIcon` |
| `Sparkles` | `sparkle`, `magic`, `stars` → `SparklesIcon`, `MagicWand01Icon` |
| `MapPin` | `location`, `pin` → `Location01Icon` |
| `Save` | `save`, `floppy` → `SaveIcon`, `FloppyDiskIcon` |
| `Send` | `mail-send` (bare `send` is noisy) | 

When several variants match, prefer:

1. The same root already used in the file or feature (`File02Icon` → stay on `02`)
2. A short base name + number over long compounds (`Delete02Icon` over `DeletePutBackIcon`)
3. Circle/square variants only when the UI needs a contained glyph

## 4. Render in React

```tsx
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

<HugeiconsIcon icon={Delete02Icon} size={16} strokeWidth={2} className="size-4" />
```

- Pass `icon={SomeIcon}` — do not treat core exports as Lucide-style components.
- Override `size`, `strokeWidth`, `className`, `color` only when needed.
- Match existing call sites in the repo.

## 5. Failure modes

| Symptom | Fix |
| --- | --- |
| `has no exported member 'TrashIcon'` | Search `delete` / `remove` → `Delete0NIcon` |
| `has no exported member 'XIcon'` | Search `cancel` / `multiplication` / `cross` |
| Import fails on pro-only name | Stay on free set, or use a pro package you actually install |
| Wrong glyph | Try numbered siblings (`01` vs `03`) or browse [hugeicons.com/icons](https://hugeicons.com/icons) |
| TypeScript error on name | Re-search `dist/esm` — do not “fix” the spelling |

## 6. Workflow checklist

1. Detect free vs pro package from `package.json` / neighboring imports.
2. Map the intent to search terms (table above + synonyms).
3. List matching files under the package’s `dist/esm`.
4. Prefer a short, numbered export already used in the codebase when possible.
5. Import from the package in use; render with `HugeiconsIcon`.
