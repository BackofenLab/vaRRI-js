# Issue #28 refactoring report

This report records behavior-preserving cleanup completed for Issue #28.

## Removed code

| Removed code | Reason |
|---|---|
| `removeBPoutsideBounds()` in `src/vaRRI.js` | It had no callers, was not exported, and duplicated cropping behavior handled by `applyCropping()`. |
| `sameLength()` in `src/vaRRI.js` | It only wrapped one direct string-length comparison, adding indirection without domain meaning. |
| Dynamic inline library loader in `index.html` | It duplicated normal script loading and could race the deferred UI script. The source library is now loaded explicitly; integrations can still select `dist/vaRRI.min.js`. |
| Empty inline `<script>` block in `index.html` | It executed no code. |
| Commented-out example buttons in `index.html` | They were unreachable UI code; the example data remains available to JavaScript callers. |
| Inline event handlers and inline presentation styles | Behavior now lives in `index.js` and presentation in `style.css`, giving each concern one owner. |
| Duplicate `#regionColor` CSS declaration | It was identical to `#subseqColor`; both now share one rule. |
| Redundant and translated button-link CSS comments/declarations | They repeated declarations or described syntax rather than project behavior. |
| `tests/ui.test.js` and `tests/ui-jsdom.test.js` | All 744 lines were commented out and the files were explicitly ignored by Jest. Active UI coverage now lives in focused structure and bootstrap tests. |
| Diagnostic environment test | It printed process and global-state details without asserting behavior. |
| Unused CSS selectors | `.row-3`, `.row-4`, `.label-dropdown-row`, `.region-color-picker`, `.swatch`, `.input-line`, and the unused radio-input rule had no consumers in any source or generated UI state. |
| Manual parenthesis URL replacements in `index.js` and `examples.js` | Native `URLSearchParams` already percent-encodes parentheses; a regression test now protects that behavior. |
| Stale `render()` legend option documentation | The option was not implemented or accepted by `render()`. |
| Duplicate `profileData2` example property and obsolete form classes/attributes | They were redundant or invalid and had no runtime effect. |

## Structural changes

- Annotation registries share internal clear/find/list/register/remove helpers.
  Public registry functions, returned object shapes, ID behavior, and errors remain
  compatible.
- The public `vaRRI` object is grouped by semantic context and alphabetized within
  each group.
- UI actions are bound centrally by `attachUiActionListeners()`; HTML contains no
  executable event attributes.
- Annotation editors share reset, error-clearing, and counter helpers. Share-link
  serialization shares registry, style, and URL-list helpers and reuses one parsed
  `URLSearchParams` instance.
- CSS color conversion shares one canvas sampler; SVG polyline and polygon creation
  share one shape insertion helper; single-molecule examples share default data.
- The HTML passes `html-validate`, repeated landmarks have unique accessible names,
  profile controls have unambiguous labels, and invalid void/form markup was removed.
- Invalid HTML (`class="checkbox-row""`) and the incorrect `list-counter` CSS
  selector were corrected.
- `src/README.md` now inventories every exported API and documents current render
  options and annotation schemas.
- `tests/ui-structure.test.js` protects script order, unique IDs, accessibility names,
  standards-compliant form markup, and separation of HTML behavior/presentation.
- Repeated VM setup and background-highlight fixtures in the test suite use shared
  helpers. The URL tests cover native parenthesis encoding and malformed alpha values.

## Remaining architectural candidates

The clone audit still identifies repeated static markup when HTML is included: parallel
annotation form controls in `index.html`, and shared header/footer fragments across
`index.html`, `examples.html`, and `citation.html`. Extracting these cleanly would require
a template or component build step. Adding that infrastructure would change the current
open-as-a-file deployment model, so it is intentionally left for a separate issue.

## Compatibility and verification

The camel-case field IDs and URL parameter names finalized before this refactor
were preserved. The default Jest suite passes 140 tests across public library, URL,
UI bootstrap, and document-structure behavior. A full-size JavaScript clone scan reports
zero clones at the six-line/50-token threshold, and `index.html` passes `html-validate`.
