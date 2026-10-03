# Tailmance Design System — Source of Truth

## Brand character
Warm, trustworthy and playful without becoming childish. The pet face is the visual hero; owner controls remain low-visibility account-management surfaces.

## Core tokens
- Deep Slate: `#0F172A`
- Vivid Coral: `#FF6B6B`
- Light background: `#F0FDF4`
- Spacing: 4 / 8 / 12 / 16 / 20 / 24 / 32
- Radius: 10 / 16 / 22 / 28 / 36 / pill
- Type: display 34/39, h1 28/33, h2 21/27, body 15/21, label 13/17, caption 11/15
- Light/dark semantic palettes live in `src/theme.ts`; raw one-off colors are prohibited outside tokens except platform-required native assets.

## Component contract
Buttons, cards, bento tiles, chips, sheets, dialogs, toasts, skeletons, Trust Pill, pet card, story ring, chat bubbles and paywall tiles must expose default, pressed, focused/selected where applicable, disabled, loading and error states. All interactive targets are at least 48dp logical size unless a platform control enforces an equivalent accessible hit target.

## Motion and haptics
Prefer short spring/physics motion. Respect reduced-motion. Haptics are semantic, never decorative spam. Infinite media surfaces must pool/dispose playback resources and obey memory guards.

## Accessibility
WCAG 2.1 AA minimum, aiming at 2.2 AA. Logical semantics/focus, non-color cues, 4.5:1 normal-text contrast, 3:1 large text, dynamic type/text scaling, RTL-safe layout, VoiceOver/TalkBack/voice-control coverage.

## Responsive layout
Safe-area aware, keyboard aware, cutout/notch aware, no fixed screen-width assumptions. Support compact/medium/expanded classes, tablets and foldables. Goldens required for light/dark × LTR/RTL × 100/130/200% text scale.

## Ownership/IP display
Settings/legal surfaces display `© 2026 Yekta Özel. All rights reserved.` and `Tailmance™`. Registered-mark symbol `®` is prohibited until registration is verified.
