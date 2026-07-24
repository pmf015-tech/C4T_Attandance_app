# C4T Attendance Prototype Design System

## 0. Reference and scope

- The supplied BIPO screenshots inform only the layout grammar: a fast employee shortcut area, information cards, persistent mobile navigation, and a desktop administration shell.
- C4T does not reuse BIPO logos, copy, image assets, or colour tokens.
- The product remains focused on attendance: clocking, attendance records, review, employees, and office policy.

## 1. Direction

Calm operational clarity. The memorable element is the light-blue attendance beacon: a focused action surface that makes the next clocking action unambiguous, while verification evidence stays visible but secondary.

## 2. Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--ink` | `#102A43` | Primary text |
| `--muted` | `#627D98` | Supporting text |
| `--line` | `#D9EAF4` | Borders and dividers |
| `--canvas` | `#F5FBFF` | Application background |
| `--surface` | `#FFFFFF` | Cards and panels |
| `--sky-50` | `#EAF7FF` | Soft blue surfaces |
| `--sky-100` | `#D2F0FF` | Focus and active surfaces |
| `--sky-600` | `#1677C8` | Primary action |
| `--sky-700` | `#0C5EAB` | Primary hover |
| `--success` | `#168C68` | Verified state |
| `--warning` | `#B7791F` | Pending and late state |
| `--danger` | `#C2413C` | Rejected state |

Typography uses the system sans stack with 700–800 weight only for titles and decisions. Spacing follows a 4px rhythm.

## 3. Layout

- Employee portal: 420px mobile-first content rail, soft blue page field, fixed bottom navigation.
- Admin portal: 248px fixed side navigation, scrolling main work area, responsive collapse below 900px.
- Cards have 16px radius, a 1px `--line` border, and a restrained blue-tinted shadow.

## 4. Interaction and motion

- Primary actions darken on hover and use a 160ms transform-free colour transition.
- Navigation active state uses a pale-blue fill with an accent bar.
- Punching updates an explicit text status; it never claims live GPS or Wi-Fi verification.

## 5. Reusable primitives and states

- `AppShell`: employee mobile rail / admin sidebar; active and compact states.
- `ActionTile`: default, hover, and disabled states.
- `StatusPill`: verified, pending, late, and review states.
- `InfoCard`: default and warning states.
- `DataTable`: default rows and selected row state.
- `PolicyField`: idle, focus, and saved feedback state.

## 6. Accessibility

- Text and action colours retain readable contrast against white or `--sky-50`.
- Every interactive control is a native button or link with a visible focus outline.
- Status is always written in text, not conveyed by colour alone.
- The prototype supports narrow and wide viewport layouts without hidden navigation traps.

## 7. Accepted prototype debt

- The portal uses demonstration data only and has no real Auth, GPS, Wi-Fi gateway, or Supabase connection yet.
- Employee identities and attendance records in this prototype are explicitly fictitious.
