"""One-off: add created_at and updated_at to every sponsor row in mock-data.js."""
import re
from pathlib import Path

src = Path(__file__).resolve().parent.parent / 'js' / 'lib' / 'mock-data.js'
text = src.read_text(encoding='utf-8')

# Spread the seed dates across Jan-Apr 2026 so the "Last updated" column
# looks plausible. Newer rows get more recent dates.
seed_dates = {
    's1':  '2026-01-15', 's2':  '2026-01-15', 's3':  '2026-01-15',
    's4':  '2026-01-15', 's5':  '2026-01-15', 's6':  '2026-01-15',
    's7':  '2026-01-15', 's8':  '2026-01-15', 's9':  '2026-04-15',  # Razer updated Apr
    's10': '2026-04-15', 's11': '2026-01-15', 's12': '2026-01-15',
    's13': '2026-01-15', 's14': '2026-01-15', 's15': '2026-04-04',  # KOI created Apr 4 per activity
    's20': '2026-04-20', 's21': '2026-01-10', 's22': '2026-01-10',
    's23': '2026-01-10', 's24': '2026-05-14',  # AIA updated May 14 per activity
    's25': '2026-01-10', 's26': '2026-01-10', 's27': '2026-01-10',
    's28': '2026-01-10', 's29': '2026-01-10',
    's40': '2026-05-19', 's41': '2026-05-08',  # closed dates per activity log
    's50': '2026-05-15',  # Tea Tribe added May 15
    's51': '2026-05-06',  # Crave Bakery added May 6
    's52': '2026-01-15',
}

# Match each sponsor row: capture { id: 'sX', ... }
row_re = re.compile(r"(\{ id: '(s\d+)'.*?notes:\s*''[^}]*\}|"
                    r"\{ id: '(s\d+)'.*?ban_reason:[^}]*\}|"
                    r"\{ id: '(s\d+)'.*?notes:\s*'[^']*'[^}]*\}|"
                    r"\{ id: '(s\d+)'.*?alumni_owner:[^}]*\})",
                    re.DOTALL)

def replace_row(m):
    row = m.group(1)
    sid = m.group(2) or m.group(3) or m.group(4) or m.group(5)
    if 'created_at' in row:
        return row
    date = seed_dates.get(sid, '2026-01-15')
    iso = date + 'T09:00:00+08:00'
    # Insert before the closing brace
    return row[:-1].rstrip() + f", created_at: '{iso}', updated_at: '{iso}' " + '}'

new_text = row_re.sub(replace_row, text)

if new_text != text:
    src.write_text(new_text, encoding='utf-8')
    print('Patched', src)
else:
    print('No changes')
