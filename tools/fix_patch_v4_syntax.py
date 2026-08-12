from pathlib import Path

path = Path('tools/patch_vision_structural_v4.py')
text = path.read_text('utf-8')
old = 'text = text.replace("local=Math.abs(gray[i]-coarse[i]);edge[i]=e;", "high[i]=gray[i]-coarse[i];const local=Math.abs(high[i]);edge[i]=e;")'
new = 'text = text.replace("local=Math.abs(gray[i]-coarse[i]);edge[i]=e;", "local=gray[i]-coarse[i];high[i]=local;edge[i]=e;")\ntext = text.replace("flat[i]=1-clamp(local/.20,0,1)", "flat[i]=1-clamp(Math.abs(local)/.20,0,1)")'
if old not in text:
    raise SystemExit('expected V4 patch line not found')
path.write_text(text.replace(old, new), 'utf-8')
