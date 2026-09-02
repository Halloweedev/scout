from pathlib import Path

path = Path("src/App.tsx")
text = path.read_text()
old_a = r'    const normalized = path.replace(/\\/g, "/").replace(/\\/$/, "");'
new_a = r'    const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");'
old_b = r'    const suffix = value.replace(/\\/g, "/").slice(source.replace(/\\/g, "/").replace(/\\/$/, "").length);'
new_b = r'    const suffix = value.replace(/\\/g, "/").slice(source.replace(/\\/g, "/").replace(/\/+$/, "").length);'
if text.count(old_a) != 1:
    raise SystemExit(f"comparable path line: {text.count(old_a)} matches")
if text.count(old_b) != 1:
    raise SystemExit(f"remap path line: {text.count(old_b)} matches")
text = text.replace(old_a, new_a).replace(old_b, new_b)
path.write_text(text)
print("Fixed Columns path regex literals")
