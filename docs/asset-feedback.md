# Asset Feedback

Human editor feedback lives in `asset_feedback.jsonl`.

Typical loop:

```powershell
python scripts\asset_feedback.py export-review --matches <matches.json> --out <review.csv>
```

Editors fill:

- `feedback_verdict`: `good`, `bad`, `discard`, `penalize`, `retag`
- `feedback_scope`: `exact_segment`, `asset_file`, or `segment_id`
- `feedback_reason`
- optional retag fields

Then import:

```powershell
python scripts\asset_feedback.py import-review --csv <review.csv> --feedback-out scripts\asset_index\asset_feedback.jsonl
```

Before drafting or reranking, apply feedback:

```powershell
python scripts\asset_feedback.py apply --matches <matches.json> --feedback scripts\asset_index\asset_feedback.jsonl --out <filtered_matches.json> --drop-rejected-candidates
```
