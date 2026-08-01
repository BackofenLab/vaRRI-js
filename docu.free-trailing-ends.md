# "Free trailing ends" feature — documentation

This document describes the "Free trailing ends" feature of vaRRI-js: what it
does, the relevant parts of Fornac's internal force-layout architecture it
depends on, and the exact steps taken to implement it.

## 1. What the feature does

vaRRI-js renders RNA/RNA-RNA-interaction structures using
[Fornac](https://github.com/ViennaRNA/fornac)'s force-directed layout
(`options.animation = true`, i.e. the "Enable Fornac force-layout animation"
checkbox). Fornac's layout algorithm pulls every *loop* of the structure
(hairpins, interior loops, multiloops, and — enabled by default — the
top-level *external loop*) into a rounded/circular shape using invisible
"fake" helper nodes and links that are not part of the actual RNA structure.

For the external loop specifically, Fornac additionally links the very first
and very last nucleotide of the whole molecule together, which visually pulls
the two free/dangling ends of the sequence(s) toward each other into a closed
ring — even though these ends have no real base-pairing there.

When the **"Free trailing ends"** checkbox is enabled (only selectable while
"Enable Fornac force-layout animation" is also enabled), vaRRI-js removes this
artificial circularisation from the force simulation:

- The two sequence ends are released from being pulled together.
- The region of the structure surrounding vaRRI's inter-molecule `&` gap
  (see below) is also released from its own circular pull.
- Every *other* loop of the structure (stems, hairpins, interior loops,
  multiloops) keeps its normal Fornac layout behaviour completely unchanged.

The net effect: the free ends of the molecule(s) can dangle naturally instead
of being forced into a closed/circular shape, while the rest of the
structure still looks exactly like a standard Fornac rendering.

## 2. UI integration

- **[index.html](index.html)** — a checkbox `#free-trailing-ends` ("Free
  trailing ends") was added directly below the existing `#animation`
  checkbox ("Enable Fornac force-layout animation"), unchecked by default.
- **[index.js](index.js)**:
  - `syncFreeTrailingEndsControl()` disables and force-unchecks
    `#free-trailing-ends` whenever `#animation` is unchecked (the feature
    only makes sense while the force simulation is actually running), and is
    wired into the `change` listener for `#animation` and called once on
    page load.
  - `runVisualization()` reads both checkboxes and passes
    `freeTrailingEnds: animation && checkbox.checked` as a new option to
    `vaRRI.render(...)`.

## 3. Required background: Fornac's internal force-graph architecture

Fornac builds its force-directed layout out of a plain object graph:

```js
container.graph = {
  nodes: [ ... ],  // all D3 force-simulation nodes
  links: [ ... ],  // all D3 force-simulation links
};
```

`container.graph.nodes` contains far more than the visible nucleotide
circles. Relevant node kinds (`nodeType`):

| `nodeType`    | Purpose                                                             | Visible in SVG? |
|---------------|----------------------------------------------------------------------|:---:|
| `"nucleotide"`| A real base of the sequence.                                        | yes |
| `"label"`     | An index label (e.g. "10", "20") shown next to certain nucleotides.  | yes |
| `"middle"`    | A synthetic helper node used purely to shape the force layout.       | no  |

### 3.1 Per-loop "hub" nodes (`addFakeNode()`)

Fornac's `reinforceLoops()` (called once per rendered RNA, from
`recalculateElements → ... → reinforceStems → reinforceLoops → ...`) iterates
over every parsed structural loop element (stems are excluded) and calls
`addFakeNode(memberIndices)` for each one. This creates:

- One synthetic **hub node**: `{ nodeType: "middle", num: -1, elemType: "f", nucs: memberIndices, uid, ... }`.
  - `nucs` is a **snapshot of the 1-based indices into `graph.nodes`** of
    every member of that loop, captured at the exact moment the hub was
    created. Since nodes are only ever *appended* to `graph.nodes`
    afterwards, these indices remain valid/stable for the lifetime of the
    graph — this makes `nucs` a reliable, hub-local record of "who belongs to
    this loop", independent of link traversal.
- For **every member** `m` of the loop (skipped if `m`'s index exceeds the
  real sequence length — see §3.2), **three** `linkType: "fake"` links:
  1. `member → hub` — a "spoke" pulling that member toward the hub's centre.
  2. `member → member` at `(f + 2) % length` — a short "skip" chord directly
     between two nearby members, bypassing the hub.
  3. `member → member` at `(f + floor(length / 2)) % length` — a
     "diameter" chord directly between two roughly-opposite members
     (only added when the loop has more than 4 members).

  Note that #2 and #3 connect two ordinary loop members **directly**,
  without going through the hub at all. This is important: simply detaching
  the hub is not enough to fully free a loop — these chord links
  independently pull opposite parts of the loop together.

- Separately, `connectFakeNodes()` links neighbouring loops' hubs to each
  other with `linkType: "fake_fake"` links wherever they share a boundary
  nucleotide (e.g. a stem's two hubs on either side).

### 3.2 The true external loop's "closure" nodes

`reinforceLoops()` treats the loop element classified as `"e"` (the
top-level *external* loop, containing every truly unpaired/exposed
nucleotide) specially — but only when Fornac's `circularizeExternal` option
is enabled (**the default**, and never overridden by vaRRI). For that
element only, **before** calling `addFakeNode`, it synthesises two extra
"closure" nodes and appends them to the loop's member list:

```js
{ nodeType: "middle", num: -3, elemType: "f", x: <last nucleotide's x>, y: <last nucleotide's y>, ... }
{ nodeType: "middle", num: -2, elemType: "f", x: <first nucleotide's x>, y: <first nucleotide's y>, ... }
```

These are positioned at the RNA's very first and very last nucleotide and
pushed into `graph.nodes` with indices that are, by construction, **beyond
the real sequence length**. This is exactly what implements the
"pull the two free ends together" effect described in §1.

**Key subtlety used by the implementation:** because the closure nodes'
member-list indices exceed the sequence length, `addFakeNode`'s per-member
guard (`if (!(index === 0 || index > sequenceLength)) { ...create spoke +
chords... }`) skips creating *any* link (spoke or chord) *from* a closure
node. Closure nodes are therefore **never directly linked to the hub**, and
only ever appear as the incidental *target* of a chord link (#2/#3 above)
originating from a couple of nearby real members. Trying to find "the hub"
by following links attached to a closure node is unreliable — it instead
finds those incidental real-nucleotide chord partners.

The reliable way to find the external loop's hub is instead: check which
hub's own `nucs` array contains one of the closure nodes' array indices
(§3.1) — only the external loop's hub was ever given those indices as
members.

### 3.3 vaRRI's inter-molecule gap and its side effect on `elemType`

To render two interacting molecules, vaRRI concatenates both structures with
a `&` separator, e.g. `structure1 + "&" + structure2`. Additionally, vaRRI
inserts 3 extra unpaired `.` characters right after the `&`
(`formatStructure`/`formatSequence` in [src/vaRRI.js](src/vaRRI.js)) as a
workaround for a Fornac bug that otherwise incorrectly drops/mis-renders the
first two real nucleotides of the second molecule. These extra dot
characters and their corresponding "gap" nodes are later hidden from the DOM
by vaRRI's own `removeDummyNodes()`.

Fornac's `breakNodesToFakeNodes()` (run at the very end of the `addRNA`
pipeline) inspects every structural loop element and, **for any element that
contains a position adjacent to the `&` break**, overwrites the `elemType`
of *every* member of that element to `"e"` — the same label used for the
true external loop — **regardless of that element's real loop type**
(stem/hairpin/interior/multiloop). In other words, the loop directly
enclosing vaRRI's inter-molecule gap gets cosmetically relabelled as if it
were exterior, even though structurally it usually is not.

This is exactly why users perceive "the region around the `&` spacer" as
also being circularly constrained: it has its own hub (created earlier during
`reinforceLoops()`, under its true original loop type — this relabelling
happens too late to affect whether that loop got closure nodes) that Fornac
never intended as "external", but whose members now look "external" by
label. To fully satisfy the "free the external/trailing nodes" requirement,
this gap-adjacent loop's hub must be freed the same way as the true external
loop's hub.

## 4. Implementation steps (in [src/vaRRI.js](src/vaRRI.js))

1. **Identify every "freeable" hub — `getFreeableLoopScaffoldUids(graph)`**
   - Find the closure nodes: `nodeType === "middle" && (num === -2 || num === -3)`.
     Record their `uid`s (`closureUids`) and their current 1-based array
     indices in `graph.nodes` (`closureIndices`).
   - Find every hub: `nodeType === "middle" && num === -1 && Array.isArray(nucs)`.
   - For each hub, resolve its `nucs` indices back to actual node objects
     (`graph.nodes[idx - 1]`), and mark the hub as freeable if **either**:
     - its own `nucs` contains one of the `closureIndices` (→ this is the
       true external loop's hub), **or**
     - any of its resolved real members has `elemType === "e"` (→ this hub's
       loop touches vaRRI's inter-molecule gap, per §3.3).
   - Collect the `uid`s of all freeable hubs (`hubUids`) and, for every
     freeable hub, the `uid`s of *all* of its members plus the closure nodes
     (`memberUids`) — this member set is what's needed to remove the direct
     member-to-member chord links in the next step.
   - Return `null` if nothing qualifies (e.g. structures with no exposed
     exterior region at all).

2. **Remove the identified scaffold — `relaxForceGraphScaffold(container, v)`**
   - Build `removableNodeUids` = `closureUids ∪ hubUids`.
   - Filter `graph.links`, dropping any `linkType === "fake" | "fake_fake"`
     link where:
     - either endpoint's `uid` is in `removableNodeUids` (removes hub spokes
       and any link touching a closure node), **or**
     - **both** endpoints' `uid`s are in `memberUids` (removes the direct
       member-to-member chord links described in §3.1, which otherwise
       bypass the hub entirely and keep pulling opposite loop members
       together even after the hub itself is gone).
   - Filter `graph.nodes`, removing only nodes whose `uid` is in
     `removableNodeUids` — i.e. **only** the freed hub(s) and the closure
     nodes are deleted. Real nucleotide nodes are **never** removed; only
     their links to the freed hub/closures/chord-partners are pruned, so
     they remain fully connected via their normal backbone/base-pair links
     and any *other* loop's hub they may also belong to.
   - Call `container.update()` so Fornac's D3 selections/force simulation
     pick up the mutated `graph.nodes`/`graph.links` arrays, then
     `container.force.resume()` (or `.start()` as a fallback) to restart the
     simulation so the layout actually relaxes into the new, unconstrained
     shape.

3. **Wire it into `render(...)`**
   - `render(containerId, v, options)` accepts a new
     `options.freeTrailingEnds` flag (default `false`).
   - Immediately after `container.addRNA(...)` builds the initial force
     graph, and only when both `animation` and `freeTrailingEnds` are true,
     call `relaxForceGraphScaffold(container, v)` once, before any further
     DOM post-processing happens.

## 5. Why a naive "just delete DOM nodes" approach does not work

Deleting the SVG `<circle>`/`<g>` elements for the hub/closure nodes (as
`removeDummyNodes()` already does for the invisible gap nodes) only affects
what is *rendered* — it does **nothing** to Fornac's underlying force
simulation, which keeps operating on `container.graph.nodes`/`.links`
independently of the DOM. The hub and closure nodes (and their links) must be
removed from the **graph data itself**, and the D3 force layout must be
explicitly re-synced (`container.update()`) and restarted
(`container.force.resume()`) for the removal to actually change the layout.

## 6. Correctness pitfalls encountered during implementation

These are recorded here because they are easy to reintroduce if this code is
ever refactored:

1. **Do not infer the hub via link adjacency to the closure nodes.**
   Closure nodes are only ever reached via incidental chord links from a
   couple of nearby real nucleotides (§3.2); following those links
   misidentifies real nucleotides as "the hub" and deletes them from the
   graph, silently removing visible nucleotides from the rendering. Use the
   hub's own `nucs` array instead.
2. **Removing only the hub and closure nodes is not sufficient.**
   The direct member-to-member "chord" links (§3.1, #2/#3) still connect
   opposite sides of the loop even with the hub gone, and remain visually
   indistinguishable from "still circularly constrained". Both hub spokes
   *and* inter-member chords must be removed.
3. **`elemType === "e"` is not exclusive to the true external loop.**
   Fornac's `breakNodesToFakeNodes()` relabels *any* loop touching a
   structural break (vaRRI's inter-molecule gap) to `elemType: "e"` too,
   regardless of its real loop type. Only checking for the closure-node
   hub misses this second region entirely; both conditions must be checked.
