from pathlib import Path

path = Path('.github/workflows/deploy-wwsync.yml')
text = path.read_text('utf-8')
old = "ANCHOR_FREE_STRUCTURAL_V2"
new = "ANCHOR_FREE_STRUCTURAL_V3"
if old not in text:
    raise SystemExit('deploy workflow no longer contains V2 contract marker')
text = text.replace(old, new)
path.write_text(text, 'utf-8')
