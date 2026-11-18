import os
import subprocess
import pygit2
import re
from datetime import datetime
import sys
import time

from pygit2_compat import harden_pygit2_config, disable_symlinks


def is_auth_error(exc):
    msg = str(exc).lower()
    return (
        "authentication" in msg
        or "callback" in msg
        or "unsupported url protocol" in msg
        or "credential" in msg
    )


def system_git_available():
    try:
        subprocess.run(
            ["git", "--version"], capture_output=True, timeout=10
        )
        return True
    except Exception:
        return False


def system_git_fetch(repo_path, refspecs):
    try:
        result = subprocess.run(
            ["git", "-c", "safe.directory=*", "-C", repo_path,
             "fetch", "origin"] + list(refspecs),
            capture_output=True, timeout=900, text=True,
        )
        if result.stdout:
            print(result.stdout)
        if result.stderr:
            print(result.stderr)
        return result.returncode == 0
    except Exception as ex:
        print("System git fetch error: %s" % ex)
        return False


_STABLE_TAG_RE = re.compile(r"^v\d+\.\d+\.\d+$")


def find_latest_stable_tag(repo):
    versions = []
    for ref_name in repo.references:
        prefix = "refs/tags/v"
        if ref_name.startswith(prefix):
            try:
                parts = tuple(map(int, ref_name[len(prefix):].split(".")))
                versions.append((parts, ref_name))
            except (ValueError, IndexError):
                pass
    versions.sort()
    return versions[-1][1] if versions else None


def _parse_tag_arg(argv):
    for i, arg in enumerate(argv):
        if arg == "--tag" and i + 1 < len(argv):
            return argv[i + 1]
        if arg.startswith("--tag="):
            return arg[len("--tag="):]
    return None


def main():
    if len(sys.argv) < 2:
        print("Usage: python update_comfyui.py <repo_path> [--stable | --tag <vX.Y.Z>]")
        sys.exit(1)

    repo_path = os.path.abspath(sys.argv[1].rstrip("/\\"))
    stable = "--stable" in sys.argv
    explicit_tag = _parse_tag_arg(sys.argv)

    if explicit_tag is not None:
        if not _STABLE_TAG_RE.match(explicit_tag):
            print("Error: --tag must be a stable release tag like v1.19.5 "
                  "(got %r)" % explicit_tag)
            sys.exit(2)
        if stable:
            print("Error: --tag and --stable are mutually exclusive")
            sys.exit(2)

    pygit2.option(pygit2.GIT_OPT_SET_OWNER_VALIDATION, 0)
    http_proxy = harden_pygit2_config()

    git_dir = os.path.join(repo_path, '.git')

    for sub in ['refs/heads', 'refs/tags', 'refs/remotes']:
        os.makedirs(os.path.join(git_dir, sub), exist_ok=True)
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
        print("Error: could not open git repository at %s" % repo_path)
        for err in errors:
            print(err)
        print(".git contents: %s" % os.listdir(git_dir))
        sys.exit(1)

    disable_symlinks(repo)

    for name in ("HEAD.lock", "index.lock", "packed-refs.lock", "refs/heads/master.lock"):
        lock = os.path.join(git_dir, name)
        try:
            if time.time() - os.path.getmtime(lock) > 60:
                os.remove(lock)
        except OSError:
            pass

    pre_head = str(repo.head.target)
    print("[PRE_UPDATE_HEAD] %s" % pre_head)

    repo.state_cleanup()

    backup_name = "backup_branch_%s" % datetime.today().strftime("%Y-%m-%d_%H_%M_%S")
    print("Creating backup branch: %s" % backup_name)
    try:
        repo.branches.local.create(backup_name, repo.head.peel())
        print("[BACKUP_BRANCH] %s" % backup_name)
        repo.index.add_all()
        if repo.index.diff_to_tree(repo.head.peel().tree):
            tree = repo.index.write_tree()
            ident = pygit2.Signature("comfyui", "comfy@ui")
            backup_ref = "refs/heads/%s" % backup_name
            repo.create_commit(
                backup_ref, ident, ident,
                "Backup of uncommitted changes before update",
                tree, [repo.head.target],
            )
            print("Uncommitted changes saved to backup branch.")
    except Exception:
        print("Warning: could not create backup branch.")
    repo.index.read_tree(repo.head.peel().tree)

    print("Fetching from origin...")
    refspecs = [
        "+refs/heads/master:refs/remotes/origin/master",
        "+refs/tags/*:refs/tags/*",
    ]
    origin = None
    for remote in repo.remotes:
        if remote.name == "origin":
            origin = remote
            break
    if origin is not None:
        force_pygit2 = os.environ.get("COMFY_FORCE_PYGIT2") == "1"
        try:
            origin.fetch(refspecs, proxy=http_proxy or None)
        except Exception as e:
            print("[WARN] pygit2 fetch from origin failed: %s" % e)
            if (not force_pygit2 and is_auth_error(e)
                    and system_git_available()):
                print("Retrying fetch with system git (honors your git config)...")
                if not system_git_fetch(repo_path, refspecs):
                    print("[ERROR] Failed to fetch from origin.")
                    print("Check your internet connection and try again.")
                    sys.exit(1)
                print("System git fetch succeeded.")
            else:
                print("[ERROR] Failed to fetch from origin: %s" % e)
                if is_auth_error(e):
                    print("Git authentication was required for an anonymous "
                          "fetch. This usually means your git config rewrites "
                          "GitHub HTTPS URLs to SSH; the bundled updater "
                          "fetches over anonymous HTTPS and cannot use SSH "
                          "credentials.")
                else:
                    print("Check your internet connection and try again.")
                sys.exit(1)
    else:
        print("[ERROR] This ComfyUI install has no 'origin' git remote, so there is "
              "nothing to update from.")
        sys.exit(1)

    ref = None
    if stable:
        tag = find_latest_stable_tag(repo)
        if tag is not None:
            print("Checking out stable tag: %s" % tag)
            ref = repo.lookup_reference(tag)
        else:
            print("No stable tags found, staying on master.")
    elif explicit_tag is not None:
        ref_name = "refs/tags/%s" % explicit_tag
        try:
            ref = repo.lookup_reference(ref_name)
        except (KeyError, pygit2.GitError):
            ref = None
        if ref is None:
            print("Error: tag %s not found in repository. The fetch step "
                  "above pulls +refs/tags/*; if this persists the tag may "
                  "have been deleted upstream or the remote is unreachable."
                  % explicit_tag)
            sys.exit(3)
        print("Checking out tag: %s" % explicit_tag)

    print("Resetting to origin/master…")
    try:
        remote_ref = repo.lookup_reference("refs/remotes/origin/master")
    except KeyError:
        print("[ERROR] origin has no master branch to update to.")
        sys.exit(1)
    remote_id = remote_ref.target
    target_id = remote_id if ref is None else ref.peel(pygit2.Commit).id
    branch = repo.lookup_branch("master")
    pre_reset_head = repo.head.target
    was_detached = repo.head_is_detached
    pre_head_ref = None if was_detached else repo.head.name
    pre_master_target = branch.target if branch is not None else None
    print("[WRITING_TARGET] %s" % target_id, flush=True)
    try:
        if branch is None:
            repo.create_branch("master", repo.get(remote_id))
        else:
            branch.set_target(remote_id)
        repo.set_head("refs/heads/master" if ref is None else target_id)
        repo.reset(target_id, pygit2.GIT_RESET_HARD)
    except Exception as exc:
        print("[ERROR] Update checkout failed: %s" % exc)
        try:
            restore_branch = repo.lookup_branch("master")
            if pre_master_target is not None:
                if restore_branch is None:
                    repo.create_branch("master", repo.get(pre_master_target))
                else:
                    restore_branch.set_target(pre_master_target)
            if was_detached:
                repo.set_head(pre_reset_head)
            else:
                repo.set_head(pre_head_ref)
            repo.reset(pre_reset_head, pygit2.GIT_RESET_HARD)
            print("Restored ComfyUI source to pre-update commit %s"
                  % str(pre_reset_head)[:7])
        except Exception as restore_exc:
            print("[ERROR] Failed to restore pre-update state: %s" % restore_exc)
        sys.exit(1)

    if ref is not None:
        print("[CHECKED_OUT_TAG] %s" % ref.shorthand)

    post_head = str(repo.head.target)
    print("[POST_UPDATE_HEAD] %s" % post_head)

    print("Done!")


if __name__ == "__main__":
    main()
