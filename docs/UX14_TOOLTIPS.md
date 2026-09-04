# UX 14 — Tooltips and affordance discovery

Scout uses one lightweight tooltip interaction layer for compact controls instead of relying on slow browser-native title popovers or invisible labels alone.

- Explicit control `title` text remains the preferred explanatory tooltip copy.
- Compact icon controls can fall back to their existing `aria-label`, so accessibility labels also improve pointer discoverability without duplicating labels on ordinary text buttons.
- Pointer hover uses a short deliberate delay; moving between nearby controls becomes faster once the first tooltip has appeared.
- Keyboard-driven focus can reveal the same tooltip quickly after Tab, arrow, Home, or End navigation without reacting to ordinary programmatic focus changes.
- Tooltips never steal focus or pointer input.
- Native `title` popovers are suppressed only while Scout owns the active tooltip interaction, then restored exactly for the underlying control.
- Tooltips clamp to the viewport and flip above the target when there is not enough space below.
- Pointer press, Escape, focus departure, scrolling, resizing, and target removal dismiss the tooltip immediately.
- Touch pointer hover is ignored, and held-pointer gestures do not produce tooltips while dragging.
- Reduced-motion preferences remove tooltip transitions.
- HMR cleanup removes listeners, tooltip DOM, timers, and restores any temporarily suppressed native titles.

UX 14 is presentation-only. Existing buttons, actions, shortcuts, focus semantics, and command ownership remain unchanged.
