# Editor undo: what the server could do (WEB 11-27; the page already copes)

The page now treats `undone === 0` as a failed undo and runs undo/redo one at a time, so nothing here is required for correctness. For a later migration:

- `undo_edit_ops` (migration 20261027000400, ~line 271-311) answers ok with `undone: 0, skipped: 1` for an op that is already undone. A distinct answer (an error code such as PT410 "already undone") would let the page say so exactly instead of a generic sentence.
- The same function could refuse an undo whose `p_op_id` is not the newest applied op of that person, so a stale tab cannot undo out of order.
