import os
import re
import sys
import time
from collections import deque

import pygit2

from pygit2_compat import harden_pygit2_config, disable_symlinks


try:
    from pygit2.enums import ObjectType as _ObjectType
    GIT_OBJ_COMMIT = int(_ObjectType.COMMIT)
except (ImportError, AttributeError):
    GIT_OBJ_COMMIT = pygit2.GIT_OBJ_COMMIT

try:
    from pygit2.enums import SortMode as _SortMode
    GIT_SORT_TOPOLOGICAL = int(_SortMode.TOPOLOGICAL)
except (ImportError, AttributeError):
    GIT_SORT_TOPOLOGICAL = pygit2.GIT_SORT_TOPOLOGICAL


HTTP_PROXY = None


def to_https_url(url):
    if not url:
        return url
    m = re.match(r"^(?:ssh://)?git@([^:/]+)[:/](.+)$", url)
    if m:
        return "https://%s/%s" % (m.group(1), m.group(2))
    return url


def open_repo(repo_path):
    repo_path = os.path.abspath(repo_path.rstrip("/\\"))
    git_dir = os.path.join(repo_path, ".git")

    for sub in ["refs/heads", "refs/tags", "refs/remotes"]:
        try:
            os.makedirs(os.path.join(git_dir, sub), exist_ok=True)
        except OSError:
            pass

    repo = None
    errors = []
    for candidate in [git_dir, repo_path]:
        try:
            repo = pygit2.Repository(candidate)
            break
        except Exception as e:
            errors.append("  %s -> %s" % (candidate, e))

    if repo is None:
        try:
            repo = pygit2.Repository(git_dir.replace("\\", "/"))
        except Exception as e:
            errors.append("  %s -> %s" % (git_dir.replace("\\", "/"), e))

    if repo is None:
        print("Error: could not open git repository at %s" % repo_path, file=sys.stderr)
        for err in errors:
            print(err, file=sys.stderr)
        sys.exit(1)

    disable_symlinks(repo)

    return repo


def resolve_ref(repo, ref):
    if ref == "HEAD":
        return repo.head.target

    try:
        tag_ref = repo.lookup_reference("refs/tags/%s" % ref)
        obj = tag_ref.peel(pygit2.Commit)
        return obj.id
    except (KeyError, ValueError):
        pass

    try:
        branch_ref = repo.lookup_reference("refs/heads/%s" % ref)
        return branch_ref.peel(pygit2.Commit).id
    except (KeyError, ValueError):
        pass

    try:
        remote_ref = repo.lookup_reference("refs/remotes/origin/%s" % ref)
        return remote_ref.peel(pygit2.Commit).id
    except (KeyError, ValueError):
        pass

    try:
        full_ref = repo.lookup_reference(ref)
        return full_ref.peel(pygit2.Commit).id
    except (KeyError, ValueError):
        pass

    try:
        obj = repo.revparse_single(ref)
        commit = obj.peel(pygit2.Commit)
        return commit.id
    except (KeyError, ValueError):
        pass

    print("Error: could not resolve ref '%s'" % ref, file=sys.stderr)
    sys.exit(1)


def parse_version_tuple(tag_name):
    name = tag_name
    if name.startswith("v"):
        name = name[1:]
    try:
        return tuple(int(x) for x in name.split("."))
    except (ValueError, IndexError):
        return None


def get_origin(repo):
    for remote in repo.remotes:
        if remote.name == "origin":
            return remote
    print("Error: no 'origin' remote found", file=sys.stderr)
    sys.exit(1)


def build_tag_target_map(repo):
    tag_map = {}
    for ref_name in repo.references:
        if ref_name.startswith("refs/tags/"):
            tag_name = ref_name[len("refs/tags/"):]
            try:
                ref = repo.lookup_reference(ref_name)
                target = ref.peel(pygit2.Commit)
                tag_map[target.id] = tag_name
            except (KeyError, ValueError):
                pass
    return tag_map


def cmd_rev_parse(repo_path, ref):
    repo = open_repo(repo_path)
    oid = resolve_ref(repo, ref)
    print(str(oid))


def cmd_tracked_changes(repo_path):
    repo = open_repo(repo_path)
    for path in repo.status(untracked_files="no"):
        print(path)


HAS_COMMIT_ABSENT = 3
MERGE_BASE_NONE = 5


def cmd_has_commit(repo_path, sha):
    repo = open_repo(repo_path)
    try:
        obj = repo.get(sha)
    except ValueError:
        sys.exit(HAS_COMMIT_ABSENT)
    if obj is None:
        sys.exit(HAS_COMMIT_ABSENT)
    try:
        obj.peel(pygit2.Commit)
    except (KeyError, ValueError, pygit2.InvalidSpecError):
        sys.exit(HAS_COMMIT_ABSENT)
    sys.exit(0)


def cmd_describe_tags(repo_path, commit="HEAD"):
    repo = open_repo(repo_path)
    start_oid = resolve_ref(repo, commit)
    tag_map = build_tag_target_map(repo)

    if not tag_map:
        print("Error: no tags found in repository", file=sys.stderr)
        sys.exit(1)

    visited = set()
    queue = deque([start_oid])
    while queue:
        oid = queue.popleft()
        if oid in visited:
            continue
        visited.add(oid)

        if oid in tag_map:
            print(tag_map[oid])
            return

        try:
            commit_obj = repo.get(oid)
            if commit_obj is not None and commit_obj.type == GIT_OBJ_COMMIT:
                for parent_id in commit_obj.parent_ids:
                    if parent_id not in visited:
                        queue.append(parent_id)
        except (KeyError, ValueError):
            pass

    print("Error: no ancestor tag found", file=sys.stderr)
    sys.exit(1)


def cmd_tag_list(repo_path):
    repo = open_repo(repo_path)

    tags = []
    for ref_name in repo.references:
        if ref_name.startswith("refs/tags/v"):
            tag_name = ref_name[len("refs/tags/"):]
            version = parse_version_tuple(tag_name)
            if version is not None:
                tags.append((version, tag_name))

    tags.sort(reverse=True)
    for _, tag_name in tags:
        print(tag_name)


def cmd_rev_list_count(repo_path, tag_or_ref, commit="HEAD"):
    repo = open_repo(repo_path)
    tag_oid = resolve_ref(repo, tag_or_ref)
    commit_oid = resolve_ref(repo, commit)

    if tag_oid == commit_oid:
        print(0)
        return

    walker = repo.walk(commit_oid, GIT_SORT_TOPOLOGICAL)
    walker.hide(tag_oid)
    print(sum(1 for _ in walker))


def cmd_cherry_pick_count(repo_path, ref1, ref2):
    repo = open_repo(repo_path)
    oid1 = resolve_ref(repo, ref1)
    oid2 = resolve_ref(repo, ref2)

    try:
        base_oid = repo.merge_base(oid1, oid2)
    except Exception:
        print("Error: could not find merge-base", file=sys.stderr)
        sys.exit(1)

    if base_oid is None:
        print("Error: no common ancestor found", file=sys.stderr)
        sys.exit(1)

    walker = repo.walk(oid1, GIT_SORT_TOPOLOGICAL)
    walker.hide(base_oid)
    print(sum(1 for _ in walker))


def cmd_merge_base(repo_path, ref1, ref2):
    repo = open_repo(repo_path)
    oid1 = resolve_ref(repo, ref1)
    oid2 = resolve_ref(repo, ref2)

    try:
        base_oid = repo.merge_base(oid1, oid2)
    except Exception:
        print("Error: could not find merge-base", file=sys.stderr)
        sys.exit(1)

    if base_oid is None:
        print("Error: no common ancestor found", file=sys.stderr)
        sys.exit(MERGE_BASE_NONE)

    print(str(base_oid))


def cmd_is_ancestor(repo_path, ancestor, descendant):
    repo = open_repo(repo_path)
    ancestor_oid = resolve_ref(repo, ancestor)
    descendant_oid = resolve_ref(repo, descendant)

    if ancestor_oid == descendant_oid:
        sys.exit(0)

    try:
        base_oid = repo.merge_base(ancestor_oid, descendant_oid)
    except Exception:
        sys.exit(1)

    if base_oid is not None and base_oid == ancestor_oid:
        sys.exit(0)
    else:
        sys.exit(1)


def cmd_fetch_tags(repo_path):
    repo = open_repo(repo_path)
    origin = get_origin(repo)

    try:
        origin.fetch(
            ["+refs/tags/*:refs/tags/*"],
            depth=0,
            proxy=HTTP_PROXY,
        )
        print("Fetched tags (unshallowed).", file=sys.stderr)
        return
    except Exception:
        pass

    try:
        origin.fetch(["+refs/tags/*:refs/tags/*"], proxy=HTTP_PROXY)
        print("Fetched tags.", file=sys.stderr)
        return
    except Exception as e:
        print("Error: failed to fetch tags: %s" % e, file=sys.stderr)
        sys.exit(1)


def cmd_fetch_commit(repo_path, sha):
    repo = open_repo(repo_path)
    origin = get_origin(repo)

    last_error = None

    try:
        origin.fetch([sha], proxy=HTTP_PROXY)
    except Exception as e:
        last_error = e
        try:
            origin.fetch(depth=0, proxy=HTTP_PROXY)
        except Exception as e2:
            last_error = e2
            try:
                origin.fetch(proxy=HTTP_PROXY)
            except Exception as e3:
                last_error = e3

    try:
        repo[sha]
    except (KeyError, ValueError):
        msg = (
            "fetch did not deliver commit %s" % sha
            if last_error is None
            else "fetch failed for commit %s: %s" % (sha, last_error)
        )
        print("Error: %s" % msg, file=sys.stderr)
        sys.exit(1)

    print("Fetched commit %s." % sha, file=sys.stderr)


def _format_bytes(n):
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if n < 1024 or unit == "TiB":
            return "%.1f %s" % (n, unit)
        n /= 1024.0


def cmd_clone(url, dest):
    url = to_https_url(url)
    print("Downloading ComfyUI source from %s into %s ..." % (url, dest),
          file=sys.stderr)
    try:
        class Progress(pygit2.RemoteCallbacks):
            def __init__(self):
                super().__init__()
                self._last_emit = 0.0
                self._last_total = 0

            def transfer_progress(self, stats):
                now = time.monotonic()
                total = stats.total_objects or 0
                indexed = stats.indexed_objects or 0
                done = total > 0 and indexed >= total
                if (not done
                        and self._last_total == total
                        and now - self._last_emit < 1.0):
                    return
                self._last_emit = now
                self._last_total = total
                pct = (indexed * 100 // total) if total else 0
                print("  Downloading: %d%% (%d/%d objects, %s received)" % (
                    pct, indexed, total,
                    _format_bytes(stats.received_bytes)),
                    file=sys.stderr)

        def _init_no_symlinks(path, bare):
            repo = pygit2.init_repository(path, bare)
            disable_symlinks(repo)
            return repo

        pygit2.clone_repository(
            url, dest, callbacks=Progress(), proxy=HTTP_PROXY,
            repository=_init_no_symlinks,
        )
        print("Download complete.", file=sys.stderr)
    except Exception as e:
        print("Error: clone failed: %s" % e, file=sys.stderr)
        if "callback" in str(e) or "authentication" in str(e).lower():
            print("Git authentication was required for an anonymous clone. "
                  "This usually means your git config rewrites GitHub HTTPS "
                  "URLs to SSH; the launcher clones over anonymous HTTPS and "
                  "cannot use SSH credentials.", file=sys.stderr)
        sys.exit(1)


def _try_resolve_ref(repo, ref):
    if ref == "HEAD":
        try:
            return repo.head.target
        except Exception:
            return None

    for full in (
        "refs/tags/%s" % ref,
        "refs/heads/%s" % ref,
        "refs/remotes/origin/%s" % ref,
        ref,
    ):
        try:
            r = repo.lookup_reference(full)
            return r.peel(pygit2.Commit).id
        except (KeyError, ValueError):
            continue

    try:
        obj = repo.revparse_single(ref)
        return obj.peel(pygit2.Commit).id
    except (KeyError, ValueError):
        return None


def _ensure_commit_local(repo, commit):
    if _try_resolve_ref(repo, commit) is not None:
        return True, None

    origin = get_origin(repo)
    last_error = None

    try:
        origin.fetch([commit])
    except Exception as e:
        last_error = e
        try:
            origin.fetch(depth=0, proxy=HTTP_PROXY)
        except Exception as e2:
            last_error = e2
            try:
                origin.fetch(proxy=HTTP_PROXY)
            except Exception as e3:
                last_error = e3

    if _try_resolve_ref(repo, commit) is not None:
        return True, None
    return False, last_error


def _try_checkout_existing(repo, commit, strategy):
    oid = _try_resolve_ref(repo, commit)
    if oid is None:
        return None
    commit_obj = repo.get(oid)
    repo.checkout_tree(commit_obj, strategy=strategy)
    repo.set_head(oid)
    return str(oid)


def cmd_checkout(repo_path, commit):
    repo = open_repo(repo_path)

    existing = _try_checkout_existing(repo, commit, pygit2.GIT_CHECKOUT_SAFE)
    if existing is not None:
        print("Checked out %s" % existing, file=sys.stderr)
        return

    print("Commit not found locally, fetching from origin...", file=sys.stderr)
    ok, last_error = _ensure_commit_local(repo, commit)
    if not ok:
        msg = (
            "fetch did not deliver commit %s" % commit
            if last_error is None
            else "fetch failed for commit %s: %s" % (commit, last_error)
        )
        print("Error: %s" % msg, file=sys.stderr)
        sys.exit(1)

    try:
        oid = resolve_ref(repo, commit)
        commit_obj = repo.get(oid)
        repo.checkout_tree(commit_obj, strategy=pygit2.GIT_CHECKOUT_SAFE)
        repo.set_head(oid)
        print("Checked out %s" % str(oid), file=sys.stderr)
    except Exception as e:
        print("Error: checkout failed after fetch: %s" % e, file=sys.stderr)
        sys.exit(1)


def cmd_fetch_and_checkout(repo_path, commit):
    repo = open_repo(repo_path)
    origin = get_origin(repo)

    refspecs = [
        "+refs/heads/master:refs/remotes/origin/master",
        "+refs/tags/*:refs/tags/*",
    ]

    try:
        origin.fetch(refspecs, depth=0, proxy=HTTP_PROXY)
    except Exception:
        try:
            origin.fetch(refspecs, proxy=HTTP_PROXY)
        except Exception as e:
            print("Error: failed to fetch from origin: %s" % e, file=sys.stderr)
            sys.exit(1)

    try:
        repo.set_head(repo.head.target)
    except Exception:
        pass

    try:
        remote_ref = repo.lookup_reference("refs/remotes/origin/master")
        remote_id = remote_ref.target
        branch = repo.lookup_branch("master")
        if branch is None:
            repo.create_branch("master", repo.get(remote_id))
        else:
            branch.set_target(remote_id)
    except Exception as e:
        print("Warning: could not update local master branch: %s" % e, file=sys.stderr)

    if _try_resolve_ref(repo, commit) is None:
        print("Requested commit not in fetched history; retrying with explicit SHA...", file=sys.stderr)
        ok, last_error = _ensure_commit_local(repo, commit)
        if not ok:
            msg = (
                "fetch did not deliver commit %s" % commit
                if last_error is None
                else "fetch failed for commit %s: %s" % (commit, last_error)
            )
            print("Error: %s" % msg, file=sys.stderr)
            sys.exit(1)

    try:
        oid = resolve_ref(repo, commit)
        commit_obj = repo.get(oid)
        repo.checkout_tree(commit_obj, strategy=pygit2.GIT_CHECKOUT_FORCE)
        repo.set_head(oid)
        print("Checked out %s" % str(oid), file=sys.stderr)
    except Exception as e:
        print("Error: checkout failed: %s" % e, file=sys.stderr)
        sys.exit(1)


def cmd_ls_remote_tags(url):
    import tempfile

    url = to_https_url(url)
    with tempfile.TemporaryDirectory() as tmpdir:
        repo = pygit2.init_repository(tmpdir, bare=True)
        remote = repo.remotes.create_anonymous(url)
        try:
            heads = remote.list_heads(proxy=HTTP_PROXY)
        except AttributeError:
            heads = remote.ls_remotes()

        tags = []
        for ref in heads:
            name = ref["name"] if isinstance(ref, dict) else ref.name
            if not name.startswith("refs/tags/") or name.endswith("^{}"):
                continue
            tag_name = name[len("refs/tags/"):]
            version = parse_version_tuple(tag_name)
            if version is not None:
                tags.append((version, tag_name))

        tags.sort(reverse=True)
        for _, tag_name in tags:
            print(tag_name)


def cmd_ls_remote_ref(url, ref):
    import tempfile

    url = to_https_url(url)
    with tempfile.TemporaryDirectory() as tmpdir:
        repo = pygit2.init_repository(tmpdir, bare=True)
        remote = repo.remotes.create_anonymous(url)
        try:
            heads = remote.list_heads(proxy=HTTP_PROXY)
        except AttributeError:
            heads = remote.ls_remotes()
        for head in heads:
            name = head["name"] if isinstance(head, dict) else head.name
            oid = head["oid"] if isinstance(head, dict) else head.oid
            if name == ref and oid is not None:
                print(str(oid))
                return
        print("Error: ref %s not found" % ref, file=sys.stderr)
        sys.exit(1)


USAGE = """\
Usage: python git_operations.py <subcommand> [args...]

Subcommands:
  healthcheck
  rev-parse          <repo_path> <ref>
  tracked-changes    <repo_path>
  describe-tags      <repo_path> [commit]
  tag-list           <repo_path>
  rev-list-count     <repo_path> <tag_or_ref> [commit]
  cherry-pick-count  <repo_path> <ref1> <ref2>
  merge-base         <repo_path> <ref1> <ref2>
  is-ancestor        <repo_path> <ancestor> <descendant>
  has-commit         <repo_path> <sha>
  fetch-tags         <repo_path>
  fetch-commit       <repo_path> <sha>
  clone              <url> <dest>
  checkout           <repo_path> <commit>
  fetch-and-checkout <repo_path> <commit>
  ls-remote-tags     <url>
  ls-remote-ref      <url> <ref>
"""

if __name__ == "__main__":
    pygit2.option(pygit2.GIT_OPT_SET_OWNER_VALIDATION, 0)
    HTTP_PROXY = harden_pygit2_config()

    if len(sys.argv) < 2:
        print(USAGE, file=sys.stderr)
        sys.exit(1)

    subcmd = sys.argv[1]

    try:
        if subcmd == "healthcheck":
            print("ok pygit2 %s" % getattr(pygit2, "__version__", "unknown"))
            sys.exit(0)

        elif subcmd == "rev-parse":
            if len(sys.argv) < 4:
                print("Usage: git_operations.py rev-parse <repo_path> <ref>", file=sys.stderr)
                sys.exit(1)
            cmd_rev_parse(sys.argv[2], sys.argv[3])

        elif subcmd == "tracked-changes":
            if len(sys.argv) < 3:
                print("Usage: git_operations.py tracked-changes <repo_path>", file=sys.stderr)
                sys.exit(1)
            cmd_tracked_changes(sys.argv[2])

        elif subcmd == "describe-tags":
            if len(sys.argv) < 3:
                print("Usage: git_operations.py describe-tags <repo_path> [commit]", file=sys.stderr)
                sys.exit(1)
            commit = sys.argv[3] if len(sys.argv) > 3 else "HEAD"
            cmd_describe_tags(sys.argv[2], commit)

        elif subcmd == "tag-list":
            if len(sys.argv) < 3:
                print("Usage: git_operations.py tag-list <repo_path>", file=sys.stderr)
                sys.exit(1)
            cmd_tag_list(sys.argv[2])

        elif subcmd == "rev-list-count":
            if len(sys.argv) < 4:
                print("Usage: git_operations.py rev-list-count <repo_path> <tag_or_ref> [commit]", file=sys.stderr)
                sys.exit(1)
            commit = sys.argv[4] if len(sys.argv) > 4 else "HEAD"
            cmd_rev_list_count(sys.argv[2], sys.argv[3], commit)

        elif subcmd == "cherry-pick-count":
            if len(sys.argv) < 5:
                print("Usage: git_operations.py cherry-pick-count <repo_path> <ref1> <ref2>", file=sys.stderr)
                sys.exit(1)
            cmd_cherry_pick_count(sys.argv[2], sys.argv[3], sys.argv[4])

        elif subcmd == "merge-base":
            if len(sys.argv) < 5:
                print("Usage: git_operations.py merge-base <repo_path> <ref1> <ref2>", file=sys.stderr)
                sys.exit(1)
            cmd_merge_base(sys.argv[2], sys.argv[3], sys.argv[4])

        elif subcmd == "has-commit":
            if len(sys.argv) < 4:
                print("Usage: git_operations.py has-commit <repo_path> <sha>", file=sys.stderr)
                sys.exit(1)
            cmd_has_commit(sys.argv[2], sys.argv[3])

        elif subcmd == "is-ancestor":
            if len(sys.argv) < 5:
                print("Usage: git_operations.py is-ancestor <repo_path> <ancestor> <descendant>", file=sys.stderr)
                sys.exit(1)
            cmd_is_ancestor(sys.argv[2], sys.argv[3], sys.argv[4])

        elif subcmd == "fetch-tags":
            if len(sys.argv) < 3:
                print("Usage: git_operations.py fetch-tags <repo_path>", file=sys.stderr)
                sys.exit(1)
            cmd_fetch_tags(sys.argv[2])

        elif subcmd == "fetch-commit":
            if len(sys.argv) < 4:
                print("Usage: git_operations.py fetch-commit <repo_path> <sha>", file=sys.stderr)
                sys.exit(1)
            cmd_fetch_commit(sys.argv[2], sys.argv[3])

        elif subcmd == "clone":
            if len(sys.argv) < 4:
                print("Usage: git_operations.py clone <url> <dest>", file=sys.stderr)
                sys.exit(1)
            cmd_clone(sys.argv[2], sys.argv[3])

        elif subcmd == "checkout":
            if len(sys.argv) < 4:
                print("Usage: git_operations.py checkout <repo_path> <commit>", file=sys.stderr)
                sys.exit(1)
            cmd_checkout(sys.argv[2], sys.argv[3])

        elif subcmd == "fetch-and-checkout":
            if len(sys.argv) < 4:
                print("Usage: git_operations.py fetch-and-checkout <repo_path> <commit>", file=sys.stderr)
                sys.exit(1)
            cmd_fetch_and_checkout(sys.argv[2], sys.argv[3])

        elif subcmd == "ls-remote-tags":
            if len(sys.argv) < 3:
                print("Usage: git_operations.py ls-remote-tags <url>", file=sys.stderr)
                sys.exit(1)
            cmd_ls_remote_tags(sys.argv[2])

        elif subcmd == "ls-remote-ref":
            if len(sys.argv) < 4:
                print("Usage: git_operations.py ls-remote-ref <url> <ref>", file=sys.stderr)
                sys.exit(1)
            cmd_ls_remote_ref(sys.argv[2], sys.argv[3])

        else:
            print("Unknown subcommand: %s" % subcmd, file=sys.stderr)
            print(USAGE, file=sys.stderr)
            sys.exit(1)

    except SystemExit:
        raise
    except Exception as e:
        print("Error: %s" % e, file=sys.stderr)
        sys.exit(1)
