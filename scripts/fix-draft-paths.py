# -*- coding: utf-8 -*-
"""Fix invalid JSON escapes in draft_content.json.

Problem: UNC paths have mix of single and double backslashes:
  \\\\192.168.0.93\\working files\\260407\\\\wangningjuan\\\\...
  (\\\\=correct, \\=wrong for path separators after share name)

The single \\ before "working", "260407" etc are invalid JSON escapes.

Fix: only target single backslashes that are NOT already part of a
valid JSON escape sequence.

Usage:
  python scripts/fix-draft-paths.py <root_dir>
"""

import os
import re
import sys
import json
import shutil


def fix_draft(filepath):
    """Fix unescaped backslashes in JSON string values."""
    backup = filepath + '.bak'

    # If backup exists from previous bad fix, restore it first
    if os.path.exists(backup):
        shutil.copy2(backup, filepath)
        os.remove(backup)

    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        text = f.read()

    # Test if already valid JSON
    try:
        json.loads(text)
        return False  # already fine
    except json.JSONDecodeError:
        pass

    # Backup the original broken file
    shutil.copy2(filepath, backup)

    # Fix: walk through each JSON string value, find unescaped backslashes
    # An unescaped backslash is a single \ NOT followed by: " \ / b f n r t u
    # AND NOT preceded by another \
    #
    # Strategy: process the file character by character, tracking whether
    # we're inside a JSON string
    result = []
    i = 0
    in_string = False

    while i < len(text):
        ch = text[i]

        if not in_string:
            result.append(ch)
            if ch == '"':
                in_string = True
            i += 1
        else:
            # Inside a JSON string
            if ch == '"':
                # End of string
                result.append(ch)
                in_string = False
                i += 1
            elif ch == '\\':
                # Backslash inside string - check what follows
                if i + 1 < len(text):
                    next_ch = text[i + 1]
                    if next_ch in ('"', '\\', '/', 'b', 'f', 'n', 'r', 't'):
                        # Valid 2-char escape sequence, keep as-is
                        result.append(ch)
                        result.append(next_ch)
                        i += 2
                    elif next_ch == 'u':
                        # Unicode escape \uXXXX, keep as-is
                        result.append(text[i:i+6])
                        i += 6
                    else:
                        # Invalid escape like \w, \2, \c etc
                        # Add extra backslash to make it \\w, \\2, \\c
                        result.append('\\')
                        result.append(ch)
                        i += 1
                else:
                    result.append(ch)
                    i += 1
            else:
                result.append(ch)
                i += 1

    fixed = ''.join(result)

    with open(filepath, 'w', encoding='utf-8', newline='') as f:
        f.write(fixed)
    return True


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "Z:/AI editing/working files"

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
                        # Remove backup
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
