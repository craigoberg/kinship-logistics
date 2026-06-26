## Global Placeholder Styling Standard

Establish a permanent visual distinction between placeholder prompts and real user input across every form field.

### New global standard
- Placeholders: `placeholder:text-slate-400 placeholder:italic`
- Real input text: solid, non-italic, high-contrast (`text-foreground`, inherits from base classes — unchanged)

### Changes

1. **`src/components/ui/input.tsx`**
   - Append `placeholder:text-slate-400 placeholder:italic` to the className.
   - Leave the existing `placeholder:text-muted-foreground` in place is redundant — replace it with the new slate-400 italic styling to avoid conflict.
   - Actual text styling untouched (inherits `text-base`/`text-foreground`).

2. **`src/components/ui/textarea.tsx`**
   - Same swap: replace `placeholder:text-muted-foreground` with `placeholder:text-slate-400 placeholder:italic`.

3. **`src/components/ui/character-counted-textarea.tsx`**
   - This component already forwards to the base `Textarea`, so it inherits the new placeholder styling automatically. No edit required for behavior, but I will add an explicit `placeholder:text-slate-400 placeholder:italic` to its passed `className` to make the standard self-documenting at the call site (and to guarantee correctness even if a consumer overrides classes).

### Non-goals
- No changes to actual text color, weight, or font-style.
- No changes to focus states, borders, or the red-outline required-field treatment in `CharacterCountedTextarea`.
- No edits to consumer components — they all flow through these three primitives.

### Verification
- Visually check Manage Issue dialog textarea, Login/PIN inputs, and Add Attendance Schedule modal: empty state should show italic slate-400 prompt; typed text should be solid high-contrast.
- Confirm no other component re-implements a raw `<input>`/`<textarea>` that bypasses these primitives (spot-check via the file list — all form fields in the project use these wrappers).

This becomes the permanent design standard: any future input or textarea must route through these primitives so the placeholder/real-text distinction is enforced by default.