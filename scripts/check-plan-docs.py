#!/usr/bin/env python3
"""Mechanical checks over docs/engine and docs/console.

Run from the repo root: `python3 scripts/check-plan-docs.py`. Exits non-zero
on any finding. Checks, per folder: decision rows unique; every `D<n>`
reference resolves to a row in the same folder (references prefixed
`engine `/`console ` point at the other folder and are checked there); every
`NN §M(.k)` reference resolves to a heading in doc NN of the same folder;
every table is rectangular.
"""
import collections, glob, io, re, sys

ROOT = "docs"
FOLDERS = ("engine", "console")


def load(folder):
    docs = {}
    for path in sorted(glob.glob(f"{ROOT}/{folder}/*.md")):
        docs[path.split("/")[-1][:2]] = (path, io.open(path, encoding="utf-8").read())
    return docs


def headings(text):
    return set(re.findall(r"^#{2,4} (\d+(?:\.\d+)*)\.?\s", text, re.M))


def decisions(docs):
    rows = collections.Counter()
    for _, (_, text) in docs.items():
        for m in re.finditer(r"^\| (D\d+[a-z]?) \|", text, re.M):
            rows[m.group(1)] += 1
    return rows


def check(folder, other):
    docs, findings = load(folder), []
    heads = {n: headings(t) for n, (_, t) in docs.items()}
    rows = decisions(docs)
    other_rows = decisions(load(other))
    for d, count in rows.items():
        if count > 1:
            findings.append(f"{folder}: decision {d} declared {count} times")
    prefix = re.compile(rf"(?:(engine|console)(?: 0\d| 10)? )?\bD(\d+[a-z]?)\b")
    for n, (path, text) in docs.items():
        for m in prefix.finditer(text):
            target = m.group(1)
            d = "D" + m.group(2)
            pool = other_rows if target and target != folder else rows
            if d not in pool:
                findings.append(f"{path}: reference {m.group(0)!r} resolves to no decision")
    secref = re.compile(r"(?<!engine )(?<!console )\b(0\d|10) §(\d+(?:\.\d+)*)")
    for n, (path, text) in docs.items():
        for m in secref.finditer(text):
            doc, sec = m.group(1), m.group(2)
            if doc not in heads:
                findings.append(f"{path}: {doc} §{sec} — no such doc in {folder}")
                continue
            parent = sec.rsplit(".", 1)[0] if "." in sec else None
            if sec not in heads[doc] and parent not in heads[doc]:
                findings.append(f"{path}: {doc} §{sec} — no such heading")
    for n, (path, text) in docs.items():
        lines, i = text.split("\n"), 0
        while i < len(lines):
            if lines[i].startswith("|"):
                j = i
                while j < len(lines) and lines[j].startswith("|"):
                    j += 1
                widths = {lines[k].replace("\\|", "").count("|") for k in range(i, j)}
                if len(widths) > 1:
                    findings.append(f"{path}:{i + 1}: table columns uneven {sorted(widths)}")
                i = j
            else:
                i += 1
    total = sum(t.count("\n") for _, (_, t) in docs.items())
    print(f"{folder}: {len(docs)} docs, {total} lines, {len(rows)} decisions, {len(findings)} findings")
    return findings


if __name__ == "__main__":
    all_findings = check("engine", "console") + check("console", "engine")
    for f in all_findings:
        print("  ", f)
    sys.exit(1 if all_findings else 0)
