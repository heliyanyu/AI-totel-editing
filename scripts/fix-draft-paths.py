# -*- coding: utf-8 -*-
"""Fix invalid JSON escapes in draft_content.json.

Problem: UNC paths like \\192.168.0.93\working files\260407\...
have unescaped backslashes that break JSON parsing.

Solution: read as raw text, find ALL string values containing
backslash-followed-by-non-escape-char, fix them.

Usage:
  python scripts/fix-draft-paths.py <root_dir>
"""

import os
import re
import sys
import json
import shutil


def fix_draft(filepath):
    """Fix unescaped backslashes in ALL JSON string values."""
    # Restore from backup first if exists
    backup = filepath + '.bak'
    if os.path.exists(backup):
        shutil.copy2(backup, filepath)
        os.remove(backup)

    with open(filepath, 'rb') as f:
        raw = f.read()

    original = raw
    text = raw.decode('utf-8', errors='replace')

    # Backup original
    backup = filepath + '.bak'
    shutil.copy2(filepath, backup)

    # Process character by character to properly handle JSON strings
    # Find each JSON string and fix backslashes inside it
    result = []
    i = 0
    while i < len(text):
        if text[i] == '"':
            # Start of a JSON string
            result.append('"')
            i += 1
            while i < len(text) and text[i] != '"':
                if text[i] == '\\':
                    # Check next char
                    if i + 1 < len(text):
                        next_char = text[i + 1]
                        if next_char in ('"', '\\', '/', 'b', 'f', 'n', 'r', 't'):
                            # Valid escape, keep as-is
                            result.append(text[i])
                            result.append(text[i + 1])
                            i += 2
                            continue
                        elif next_char == 'u':
                            # Unicode escape \uXXXX, keep as-is
                            result.append(text[i:i+6])
                            i += 6
                            continue
                        else:
                            # Invalid escape! Double the backslash
                            result.append('\\\\')
                            i += 1
                            continue
                    else:
                        result.append(text[i])
                        i += 1
                else:
                    result.append(text[i])
                    i += 1
            if i < len(text):
                result.append('"')
                i += 1
        else:
            result.append(text[i])
            i += 1

    fixed = ''.join(result)

    if fixed != text:
        with open(filepath, 'w', encoding='utf-8', newline='') as f:
            f.write(fixed)
        return True
    else:
        # No changes needed, remove backup
        os.remove(backup)
        return False


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "Z:/AI editing/working files/260407"

    fixed_count = 0
    error_count = 0
    skip_count = 0

    for dirpath, dirnames, filenames in os.walk(root):
        for fname in filenames:
            if fname == "draft_content.json":
                filepath = os.path.join(dirpath, fname)
                relpath = os.path.relpath(filepath, root)
                try:
                    changed = fix_draft(filepath)
                    if changed:
                        # Verify
                        with open(filepath, 'r', encoding='utf-8') as f:
                            json.load(f)
                        fixed_count += 1
                        print(f"  FIXED: {relpath}")
                        # Remove backup after successful verify
                        backup = filepath + '.bak'
                        if os.path.exists(backup):
                            os.remove(backup)
                    else:
                        skip_count += 1
                except json.JSONDecodeError as e:
                    error_count += 1
                    print(f"  STILL BAD: {relpath}: {e}")
                    # Restore backup
                    backup = filepath + '.bak'
                    if os.path.exists(backup):
                        shutil.copy2(backup, filepath)
                        os.remove(backup)
                except Exception as e:
                    error_count += 1
                    print(f"  ERROR: {relpath}: {e}")

    print(f"\nDone. Fixed: {fixed_count}, OK: {skip_count}, Errors: {error_count}")


if __name__ == "__main__":
    main()
