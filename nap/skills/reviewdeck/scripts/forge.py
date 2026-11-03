#!/usr/bin/env python3
"""Read a pull/merge request's diff, and post review comments back to it.

    python3 forge.py diff <PR or MR URL> -o review.diff
    python3 forge.py publish <PR or MR URL> review.json

GitHub (github.com or Enterprise) and GitLab (any host) are told apart by the
URL. Both act as the user, with the tokens they gave reviewdeck, injected into
this workspace as GITHUB_TOKEN and GITLAB_TOKEN. Standard library only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass


@dataclass
class Target:
    provider: str  # "github" | "gitlab"
    api: str
    project: str  # "owner/repo" or the GitLab project path
    number: str


def parse_url(url: str) -> Target:
    parsed = urllib.parse.urlparse(url.strip())
    host = parsed.netloc
    path = parsed.path.rstrip("/")
    m = re.match(r"^/(.+?)/-/merge_requests/(\d+)", path)
    if m:
        return Target("gitlab", f"{parsed.scheme}://{host}/api/v4", m.group(1), m.group(2))
    m = re.match(r"^/([^/]+/[^/]+)/pull/(\d+)", path)
    if m:
        api = "https://api.github.com" if host == "github.com" else f"{parsed.scheme}://{host}/api/v3"
        return Target("github", api, m.group(1), m.group(2))
    raise SystemExit(f"Not a GitHub PR or GitLab MR URL: {url}")


def token_for(target: Target, required: bool = True) -> str | None:
    name = "GITHUB_TOKEN" if target.provider == "github" else "GITLAB_TOKEN"
    token = os.environ.get(name)
    if not token and required:
        raise SystemExit(
            f"{name} is not set. Ask the user to add it under Git access on the reviewdeck page, "
            "then start a new conversation so the workspace picks it up."
        )
    return token


def request(target: Target, method: str, url: str, payload=None, accept: str | None = None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    # A public GitHub PR can be read without a token; everything else needs one.
    token = token_for(target, required=not (target.provider == "github" and method == "GET"))
    if target.provider == "github":
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        req.add_header("Accept", accept or "application/vnd.github+json")
        req.add_header("X-GitHub-Api-Version", "2022-11-28")
        req.add_header("User-Agent", "reviewdeck-agent")
    else:
        req.add_header("PRIVATE-TOKEN", token)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as res:
            raw = res.read().decode()
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")[:500]
        raise RuntimeError(f"{method} {url} → HTTP {exc.code}: {body}") from exc
    if accept and "diff" in accept:
        return raw
    return json.loads(raw) if raw else None


def gitlab_base(target: Target) -> str:
    project = urllib.parse.quote(target.project, safe="")
    return f"{target.api}/projects/{project}/merge_requests/{target.number}"


# --- diff ---


def gitlab_file_diff(change: dict) -> str:
    old = change.get("old_path") or change.get("new_path")
    new = change.get("new_path") or old
    patch = change.get("diff") or ""
    if not patch.strip():
        return ""
    lines = [f"diff --git a/{old} b/{new}"]
    if change.get("renamed_file") and old != new:
        lines += [f"rename from {old}", f"rename to {new}"]
    if change.get("new_file"):
        lines.append("new file mode 100644")
    if change.get("deleted_file"):
        lines.append("deleted file mode 100644")
    lines.append(f"--- {'/dev/null' if change.get('new_file') else 'a/' + old}")
    lines.append(f"+++ {'/dev/null' if change.get('deleted_file') else 'b/' + new}")
    lines += patch.rstrip("\n").splitlines()
    return "\n".join(lines)


def gitlab_diff(target: Target) -> str:
    base = gitlab_base(target)
    changes: list[dict] = []
    page = 1
    while True:
        batch = request(target, "GET", f"{base}/diffs?per_page=100&page={page}") or []
        changes += batch
        if len(batch) < 100:
            break
        page += 1
    chunks = [d for d in (gitlab_file_diff(c) for c in changes) if d]
    return "\n".join(chunks) + ("\n" if chunks else "")


def github_diff(target: Target) -> str:
    url = f"{target.api}/repos/{target.project}/pulls/{target.number}"
    return request(target, "GET", url, accept="application/vnd.github.diff")


def cmd_diff(args) -> int:
    target = parse_url(args.url)
    diff = github_diff(target) if target.provider == "github" else gitlab_diff(target)
    if not diff.strip():
        raise SystemExit("The diff is empty.")
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(diff)
    files = sum(1 for line in diff.splitlines() if line.startswith("diff --git "))
    print(json.dumps({"provider": target.provider, "files": files, "bytes": len(diff), "output": args.output}))
    return 0


# --- publish ---

MARKER = re.compile(r"<!--\s*reviewdeck:([a-f0-9]+)\s*-->")


def marker_for(comment: dict) -> str:
    seed = "|".join(str(comment.get(k, "")) for k in ("sub", "file", "line", "side", "body"))
    return hashlib.sha256(seed.encode()).hexdigest()[:16]


def body_for(comment: dict, marker: str) -> str:
    # Posted as the reviewer, in their words; the marker only keeps a re-run from posting twice.
    return f"{comment.get('body', '').strip()}\n\n<!-- reviewdeck:{marker} -->"


def existing_markers(target: Target) -> set[str]:
    if target.provider == "github":
        repo = f"{target.api}/repos/{target.project}"
        urls = [f"{repo}/issues/{target.number}/comments?per_page=100", f"{repo}/pulls/{target.number}/comments?per_page=100"]
        bodies = [c.get("body", "") for url in urls for c in request(target, "GET", url) or []]
    else:
        base = gitlab_base(target)
        discussions = request(target, "GET", f"{base}/discussions?per_page=100") or []
        bodies = [n.get("body", "") for d in discussions for n in d.get("notes", [])]
    return {m for body in bodies for m in MARKER.findall(body)}


def post_github(target: Target, head_sha: str, comment: dict, body: str) -> str:
    repo = f"{target.api}/repos/{target.project}"
    try:
        request(target, "POST", f"{repo}/pulls/{target.number}/comments", {
            "body": body,
            "commit_id": head_sha,
            "path": comment["file"],
            "line": int(comment["line"]),
            "side": "LEFT" if comment.get("side") == "deletions" else "RIGHT",
        })
        return "inline"
    except Exception as exc:
        where = f"`{comment.get('file')}:{comment.get('line')}`"
        request(target, "POST", f"{repo}/issues/{target.number}/comments", {"body": f"On {where}:\n\n{body}"})
        print(f"inline failed for {where}, posted as a comment: {exc}", file=sys.stderr)
        return "fallback"


def post_gitlab(target: Target, refs: dict, comment: dict, body: str) -> str:
    base = gitlab_base(target)
    position = {
        "position_type": "text",
        "base_sha": refs["base_sha"],
        "start_sha": refs["start_sha"],
        "head_sha": refs["head_sha"],
    }
    if comment.get("side") == "deletions":
        position.update(old_path=comment["file"], new_path=comment["file"], old_line=int(comment["line"]))
    else:
        position.update(old_path=comment["file"], new_path=comment["file"], new_line=int(comment["line"]))
    try:
        request(target, "POST", f"{base}/discussions", {"body": body, "position": position})
        return "inline"
    except Exception as exc:
        where = f"`{comment.get('file')}:{comment.get('line')}`"
        request(target, "POST", f"{base}/notes", {"body": f"On {where}:\n\n{body}"})
        print(f"inline failed for {where}, posted as a note: {exc}", file=sys.stderr)
        return "fallback"


def cmd_publish(args) -> int:
    target = parse_url(args.url)
    with open(args.review_json, encoding="utf-8") as f:
        review = json.load(f)
    if review.get("status") != "completed":
        raise SystemExit(f"Review {review.get('sessionId')} is not submitted yet (status: {review.get('status')}).")
    # Everything in `comments` is what the reviewer approved: their own and the drafts they accepted.
    comments = (review.get("submission") or {}).get("comments") or []

    result = {"sessionId": review.get("sessionId"), "comments": len(comments), "inline": 0, "fallback": 0, "duplicates": 0, "errors": []}
    seen = existing_markers(target)

    if target.provider == "github":
        pr = request(target, "GET", f"{target.api}/repos/{target.project}/pulls/{target.number}")
        head_sha = pr["head"]["sha"]
        post = lambda c, b: post_github(target, head_sha, c, b)  # noqa: E731
    else:
        refs = request(target, "GET", gitlab_base(target))["diff_refs"]
        post = lambda c, b: post_gitlab(target, refs, c, b)  # noqa: E731

    for comment in comments:
        marker = marker_for(comment)
        if marker in seen:
            result["duplicates"] += 1
            continue
        try:
            result[post(comment, body_for(comment, marker))] += 1
        except Exception as exc:
            result["errors"].append({"file": comment.get("file"), "line": comment.get("line"), "error": str(exc)})

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if result["errors"] else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    d = sub.add_parser("diff", help="write the PR/MR diff to a file")
    d.add_argument("url")
    d.add_argument("-o", "--output", default="review.diff")
    d.set_defaults(run=cmd_diff)
    p = sub.add_parser("publish", help="post a submitted review's comments to the PR/MR")
    p.add_argument("url")
    p.add_argument("review_json", help="get_review's result, saved as JSON")
    p.set_defaults(run=cmd_publish)
    args = parser.parse_args()
    return args.run(args)


if __name__ == "__main__":
    sys.exit(main())
