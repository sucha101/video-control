# Video Studio Design System

## Visual world

Video Studio takes its visual language from a small film crew's call sheet: a working document that moves a story through clear production stages. It is digital and task-first, not a paper imitation. The interface should feel calm and practical for someone entering scripts on a phone.

## Palette

- Paper: `#F4F1E9` — page background.
- Ink: `#182A31` — primary text and structural marks.
- Coral: `#C84E3A` — main action and review-needed accent.
- Surface: `#FFFEFA` — editable work area.
- Muted ink: `#59656A` — supporting text, checked for readable contrast.
- Success and error use accessible semantic colors plus a text label and icon.

Use thin rules and a vertical progress spine to group production stages. Avoid repeated floating cards, decorative gradients, dense KPI panels, and emoji icons.

## Typography and content

Use Be Vietnam Pro for Vietnamese text. Titles are compact and direct; body copy stays readable on mobile; timestamps and ordered scene numbers use tabular numerals. Keep language conversational and name the user's next action. Never expose raw queue JSON or internal errors in ordinary screens.

## Layout and interaction

- Mobile first; bottom navigation has “Video” and “Tạo video”. Desktop uses a narrow side navigation and a bounded content column.
- The video list reads as a shot list with a status gutter and one progress line per item.
- The request form orders title, script, skill, then optional voice and references. Its submit action remains reachable at the bottom of a phone viewport.
- The review page gives the 9:16 preview first, then editable caption/hashtags, channel selection, and schedule confirmation.
- Production and publishing status remain separate. “Đã gửi Buffer” is never shown as “Đã đăng”.
- Motion is brief and functional; honor reduced-motion. Loading, empty, error, disabled, and success states are designed alongside the default state.

## Accessibility

All controls have persistent visible labels, keyboard focus, and semantic HTML. Interactive targets are at least 48px high on touch screens. State always includes text and does not rely on color alone. Verify WCAG AA text contrast and layout at 320, 768, 1024, and 1440px.
