# Editor undo: what the server could do (WEB 11-27; the page already copes)

The page now treats `undone === 0` as a failed undo and runs undo/redo one at a time, so nothing here is required for correctness. For a later migration:

- `undo_edit_ops` (migration 20261027000400, ~line 271-311) answers ok with `undone: 0, skipped: 1` for an op that is already undone. A distinct answer (an error code such as PT410 "already undone") would let the page say so exactly instead of a generic sentence.
- The same function could refuse an undo whose `p_op_id` is not the newest applied op of that person, so a stale tab cannot undo out of order.

Second round (WEB 11-27, fix 2): `undone: 0, skipped: 1` is also the answer when a NEWER applied change to the same key stands, and `skipped: 0` when the draft row is missing, so the reply alone cannot tell "already undone" from "blocked". The page now settles it by reading `my_edit_ops_since(p_revision 0)` and looking up the op's own `status` (undone or rejected = already undone: the entry leaves the screen with "That change was already undone."; applied or not found = real failure, screen unchanged).
Needs, for a later migration (not required):
- `undo_edit_ops` could return the reason per op, for example `already: n` (status undone/rejected) and `blocked: n` (newer change stands), so the page needs no second read.
- `my_edit_ops_since` returns at most 200 rows; an op older than that is not found by the page's lookup and is treated as a real failure. An `editor_op_status(p_op_id)` read would remove that limit.
