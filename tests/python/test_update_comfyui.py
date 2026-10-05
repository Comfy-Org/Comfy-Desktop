"""Real-pygit2 tests for lib/update_comfyui.py and `git_operations.py
tracked-changes`, against a local origin with a master + tags layout.

A mid-update write failure is forced with a read-only directory, standing in
for a file held open by antivirus or another process on Windows.

Run: python -m unittest discover -s tests/python
"""

import os
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import unittest

LIB = os.path.join(os.path.dirname(__file__), "..", "..", "lib")
UPDATE = os.path.join(LIB, "update_comfyui.py")
GIT_OPS = os.path.join(LIB, "git_operations.py")

# Runs update_comfyui.py, and when the update's reset fails, makes argv[1] (a
# file) and its directory read-only: a file the update just wrote gets locked
# before the restore can rewrite it.
LOCK_ON_FAILURE = """
import os, runpy, stat, sys, pygit2
lock_file = sys.argv.pop(1)
sys.argv.pop(0)  # "-c": the script then sees its usual argv
real = pygit2.Repository.reset
def reset(self, *args):
    try:
        return real(self, *args)
    except Exception:
        os.chmod(lock_file, stat.S_IRUSR)
        os.chmod(os.path.dirname(lock_file), stat.S_IRUSR | stat.S_IXUSR)
        raise
pygit2.Repository.reset = reset
sys.path.insert(0, os.path.dirname(sys.argv[0]))
runpy.run_path(sys.argv[0], run_name="__main__")
"""

# Windows: an exclusively locked file can't be read, so libgit2's restore may
# report success while skipping it. Simulated: the restore (the second reset)
# runs, then argv[1] is put back at the target's content and made unreadable.
SILENT_SKIP = """
import os, runpy, stat, sys, pygit2
skipped = sys.argv.pop(1)
sys.argv.pop(0)
real = pygit2.Repository.reset
calls = []
def reset(self, *args):
    calls.append(args)
    if len(calls) == 1:
        return real(self, *args)
    os.chmod(os.path.dirname(skipped), stat.S_IRWXU)
    real(self, *args)
    with open(skipped, "w") as f:
        f.write("v2\\n")
    os.chmod(skipped, 0)
pygit2.Repository.reset = reset
sys.path.insert(0, os.path.dirname(sys.argv[0]))
runpy.run_path(sys.argv[0], run_name="__main__")
"""

# Path order matters: libgit2 writes app/ before main/, so a failure in main/
# lands after app/db.py has already been written, as in the field crash.
V1 = {"app/db.py": "v1\n", "main/main.py": "v1\n", "only_v1.txt": "x\n",
      "tag/release.py": "dev\n"}
V2 = {"app/db.py": "v2\n", "app/new.py": "v2\n", "main/main.py": "v2\n",
      "main/extra.py": "v2\n", "tag/release.py": "v2\n"}
MASTER = {"app/db.py": "m\n", "app/new.py": "m\n", "main/main.py": "m\n",
          "main/extra.py": "m\n", "only_master.txt": "m\n", "tag/release.py": "dev\n"}

# Fixture git and the helpers under test ignore the developer's config (signing,
# hooks, an http.proxy that would reroute the refused-connection fetch).
GIT_ENV = dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1",
               HOME=tempfile.gettempdir(), XDG_CONFIG_HOME=os.devnull)
NEEDS_PERMISSIONS = unittest.skipIf(
    os.name == "nt" or (hasattr(os, "geteuid") and os.geteuid() == 0),
    "read-only directories force the failure; root and Windows ignore them")


# Kills the updater as its restore starts (the second reset): what a kill -9 of
# Desktop during the restore leaves behind.
KILL_IN_RESTORE = """
import os, runpy, sys, pygit2
sys.argv.pop(1)
sys.argv.pop(0)
real = pygit2.Repository.reset
calls = []
def reset(self, *args):
    calls.append(args)
    if len(calls) == 2:
        os._exit(9)
    return real(self, *args)
pygit2.Repository.reset = reset
sys.path.insert(0, os.path.dirname(sys.argv[0]))
runpy.run_path(sys.argv[0], run_name="__main__")
"""


def git(cwd, *args):
    return subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-C", cwd, *args],
        check=True, capture_output=True, text=True, env=GIT_ENV,
    ).stdout.strip()


def write_tree(root, files):
    for name in os.listdir(root):
        if name != ".git":
            path = os.path.join(root, name)
            shutil.rmtree(path) if os.path.isdir(path) else os.remove(path)
    for rel, content in files.items():
        path = os.path.join(root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(content)


def read_tree(root):
    out = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != ".git"]
        for name in filenames:
            path = os.path.join(dirpath, name)
            with open(path) as f:
                out[os.path.relpath(path, root).replace(os.sep, "/")] = f.read()
    return out


class UpdateComfyUITest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(self._cleanup)
        work = os.path.join(self.tmp, "work")
        os.makedirs(work)
        git(work, "init", "-q", "-b", "master")
        self.sha = {}
        for name, files in (("v1", V1), ("v2", V2), ("master", MASTER)):
            write_tree(work, files)
            git(work, "add", "-A")
            git(work, "commit", "-qm", name)
            self.sha[name] = git(work, "rev-parse", "HEAD")
        git(work, "tag", "-a", "v0.1.0", "-m", "v0.1.0", self.sha["v1"])
        git(work, "tag", "-a", "v0.2.0", "-m", "v0.2.0", self.sha["v2"])
        self.origin = os.path.join(self.tmp, "origin.git")
        git(self.tmp, "clone", "-q", "--bare", work, self.origin)
        # An installed ComfyUI: detached at the old stable tag, master behind.
        self.repo = os.path.join(self.tmp, "ComfyUI")
        git(self.tmp, "clone", "-q", self.origin, self.repo)
        git(self.repo, "checkout", "-q", "--detach", self.sha["v1"])
        git(self.repo, "branch", "-f", "master", self.sha["v1"])

    def _cleanup(self):
        for dirpath, dirnames, _ in os.walk(self.tmp):
            for d in dirnames:
                os.chmod(os.path.join(dirpath, d), stat.S_IRWXU)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def lock(self, rel_dir):
        path = os.path.join(self.repo, rel_dir)
        os.chmod(path, stat.S_IRUSR | stat.S_IXUSR)
        self.addCleanup(os.chmod, path, stat.S_IRWXU)
        return path

    def update(self, *args, driver=None, driver_arg=None):
        pre = ["-c", driver, driver_arg] if driver else []
        return subprocess.run([sys.executable, *pre, UPDATE, self.repo, *args],
                              capture_output=True, text=True, env=GIT_ENV)

    def tracked_changes(self):
        r = subprocess.run([sys.executable, GIT_OPS, "tracked-changes", self.repo],
                           capture_output=True, text=True, env=GIT_ENV)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout.split()

    def head(self):
        return git(self.repo, "rev-parse", "HEAD")

    def assert_clean_at(self, sha, files):
        self.assertEqual(self.head(), sha)
        self.assertEqual(git(self.repo, "status", "--porcelain"), "")
        self.assertEqual(read_tree(self.repo), files)

    def test_stable_lands_on_the_latest_tag(self):
        r = self.update("--stable")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assert_clean_at(self.sha["v2"], V2)
        self.assertIn("[CHECKED_OUT_TAG] v0.2.0", r.stdout)
        self.assertEqual(git(self.repo, "rev-parse", "master"), self.sha["master"])
        self.assertEqual(git(self.repo, "rev-parse", "--abbrev-ref", "HEAD"), "HEAD")

    def test_latest_lands_on_master_attached(self):
        r = self.update()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assert_clean_at(self.sha["master"], MASTER)
        self.assertEqual(git(self.repo, "symbolic-ref", "HEAD"), "refs/heads/master")

    def test_explicit_tag(self):
        git(self.repo, "checkout", "-q", "--detach", self.sha["v2"])
        r = self.update("--tag", "v0.1.0")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assert_clean_at(self.sha["v1"], V1)
        self.assertIn("[CHECKED_OUT_TAG] v0.1.0", r.stdout)

    def test_missing_tag_leaves_the_install_untouched(self):
        r = self.update("--tag", "v9.9.9")
        self.assertEqual(r.returncode, 3, r.stdout + r.stderr)
        self.assertNotIn("[WRITING_TARGET]", r.stdout)
        self.assert_clean_at(self.sha["v1"], V1)
        self.assertEqual(git(self.repo, "rev-parse", "master"), self.sha["v1"])

    def test_unreachable_origin_leaves_the_install_untouched(self):
        # Nothing listens on port 1: the connection is refused, as offline.
        git(self.repo, "remote", "set-url", "origin", "http://127.0.0.1:1/x.git")
        r = self.update("--stable")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("[ERROR] Failed to fetch from origin:", r.stdout)
        self.assert_clean_at(self.sha["v1"], V1)
        self.assertEqual(git(self.repo, "rev-parse", "master"), self.sha["v1"])

    def test_failed_fetch_reports_no_write_and_changes_nothing(self):
        # A run that never printed [WRITING_TARGET] moved nothing; when Desktop
        # sees it exit, it drops its update marker, so the user's own files don't
        # block launch. (A hard kill of Desktop here leaves the marker: a known
        # limitation.)
        with open(os.path.join(self.repo, "notes.txt"), "w") as f:
            f.write("mine\n")
        with open(os.path.join(self.repo, "app", "db.py"), "w") as f:
            f.write("edited\n")
        git(self.repo, "remote", "set-url", "origin", "http://127.0.0.1:1/x.git")
        r = self.update("--stable")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertNotIn("[WRITING_TARGET]", r.stdout)
        self.assertEqual(self.head(), self.sha["v1"])
        self.assertEqual(read_tree(self.repo)["app/db.py"], "edited\n")

    def test_update_removes_untracked_files_kept_on_the_backup_branch(self):
        # As in 1.1.6: the backup step stages everything, so the reset removes
        # a stray untracked file; the backup branch keeps it.
        with open(os.path.join(self.repo, "notes.txt"), "w") as f:
            f.write("mine\n")
        self.assertEqual(self.update("--stable").returncode, 0)
        self.assert_clean_at(self.sha["v2"], V2)
        backup = git(self.repo, "branch", "--list", "backup_branch_*",
                     "--format=%(refname:short)")
        self.assertEqual(git(self.repo, "show", "%s:notes.txt" % backup), "mine")

    def test_stale_git_locks_from_a_killed_update_are_cleared(self):
        old = time.time() - 3600
        for name in ("HEAD.lock", "index.lock", "packed-refs.lock", "refs/heads/master.lock"):
            lock = os.path.join(self.repo, ".git", name)
            open(lock, "w").close()
            os.utime(lock, (old, old))
        r = self.update("--stable")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assert_clean_at(self.sha["v2"], V2)

    def test_a_fresh_git_lock_is_respected(self):
        open(os.path.join(self.repo, ".git", "HEAD.lock"), "w").close()
        self.assertEqual(self.update("--stable").returncode, 1)
        self.assertEqual(self.head(), self.sha["v1"])

    def test_stable_without_tags_lands_on_master_attached(self):
        for repo in (self.repo, self.origin):
            git(repo, "tag", "-d", "v0.1.0", "v0.2.0")
        r = self.update("--stable")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assert_clean_at(self.sha["master"], MASTER)
        self.assertEqual(git(self.repo, "symbolic-ref", "HEAD"), "refs/heads/master")
        self.assertNotIn("[CHECKED_OUT_TAG]", r.stdout)

    def test_local_changes_are_kept_on_the_backup_branch(self):
        with open(os.path.join(self.repo, "app", "db.py"), "w") as f:
            f.write("edited\n")
        r = self.update("--stable")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assert_clean_at(self.sha["v2"], V2)
        backup = git(self.repo, "branch", "--list", "backup_branch_*",
                     "--format=%(refname:short)")
        self.assertEqual(git(self.repo, "show", "%s:app/db.py" % backup), "edited")

    @NEEDS_PERMISSIONS
    def test_failed_checkout_restores_the_install(self):
        # app/ is written first (app/new.py is created), then main/extra.py
        # (target only, first in main/) cannot be created. main/main.py is never
        # touched, so the restore succeeds and must delete app/new.py again.
        self.lock("main")
        r = self.update("--stable")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("Restored ComfyUI source to pre-update commit", r.stdout)
        self.assertEqual(git(self.repo, "rev-parse", "--abbrev-ref", "HEAD"), "HEAD")
        self.assertEqual(git(self.repo, "rev-parse", "master"), self.sha["v1"])
        self.assert_clean_at(self.sha["v1"], V1)

    @NEEDS_PERMISSIONS
    def test_file_locked_before_the_update_does_not_block_the_restore(self):
        # main/ is held from the start (main/extra.py can't be created,
        # main/main.py can't be rewritten): the restore must not need it.
        main_dir = self.lock("main")
        os.chmod(os.path.join(main_dir, "main.py"), stat.S_IRUSR)
        self.addCleanup(os.chmod, os.path.join(main_dir, "main.py"), stat.S_IRUSR | stat.S_IWUSR)
        r = self.update("--stable")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("Restored ComfyUI source to pre-update commit", r.stdout)
        self.assert_clean_at(self.sha["v1"], V1)

    @NEEDS_PERMISSIONS
    def test_failure_only_the_tag_needs_restores_the_install(self):
        # tag/release.py is the same in v1 and master and differs only in v2:
        # the field failure, where only the step from master to the tag failed.
        tag_dir = self.lock("tag")
        os.chmod(os.path.join(tag_dir, "release.py"), stat.S_IRUSR)
        self.addCleanup(os.chmod, os.path.join(tag_dir, "release.py"), stat.S_IRUSR | stat.S_IWUSR)
        r = self.update("--stable")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assert_clean_at(self.sha["v1"], V1)
        self.assertEqual(git(self.repo, "rev-parse", "master"), self.sha["v1"])

    @NEEDS_PERMISSIONS
    def test_failed_latest_update_stays_detached_when_it_started_detached(self):
        self.lock("main")
        self.assertEqual(self.update().returncode, 1)
        self.assertEqual(git(self.repo, "rev-parse", "--abbrev-ref", "HEAD"), "HEAD")
        self.assertEqual(git(self.repo, "rev-parse", "master"), self.sha["v1"])
        self.assert_clean_at(self.sha["v1"], V1)

    @NEEDS_PERMISSIONS
    def test_failed_latest_update_reattaches_master(self):
        git(self.repo, "checkout", "-q", "master")
        self.lock("main")
        r = self.update()
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertEqual(git(self.repo, "symbolic-ref", "HEAD"), "refs/heads/master")
        self.assert_clean_at(self.sha["v1"], V1)

    def assert_update_repairs(self):
        # The fix for a half-updated install: run the same update again.
        r = self.update("--stable")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assert_clean_at(self.sha["v2"], V2)

    @NEEDS_PERMISSIONS
    def test_restore_blocked_by_a_lock_leaves_a_tree_update_repairs(self):
        # The update writes app/db.py, fails in main/, and app/db.py is locked
        # before the restore can put it back.
        main_dir = self.lock("main")
        app_dir = os.path.join(self.repo, "app")
        self.addCleanup(os.chmod, app_dir, stat.S_IRWXU)
        r = self.update("--stable", driver=LOCK_ON_FAILURE,
                        driver_arg=os.path.join(app_dir, "db.py"))
        self.assertIn("Failed to restore pre-update state", r.stdout)
        self.assertIn("[WRITING_TARGET] %s" % self.sha["v2"], r.stdout)
        os.chmod(main_dir, stat.S_IRWXU)
        os.chmod(app_dir, stat.S_IRWXU)
        os.chmod(os.path.join(app_dir, "db.py"), stat.S_IRUSR | stat.S_IWUSR)
        self.assertEqual(read_tree(self.repo)["app/db.py"], "v2\n")
        self.assertIn("app/db.py", self.tracked_changes())
        self.assert_update_repairs()

    @NEEDS_PERMISSIONS
    def test_update_repairs_after_a_file_locked_from_the_start(self):
        main_dir = self.lock("main")
        os.chmod(os.path.join(main_dir, "main.py"), stat.S_IRUSR)
        self.assertEqual(self.update("--stable").returncode, 1)
        os.chmod(main_dir, stat.S_IRWXU)
        os.chmod(os.path.join(main_dir, "main.py"), stat.S_IRUSR | stat.S_IWUSR)
        self.assert_update_repairs()

    @NEEDS_PERMISSIONS
    def test_silently_skipped_restore_leaves_a_tree_update_repairs(self):
        self.lock("main")
        main_py = os.path.join(self.repo, "main", "main.py")
        r = self.update("--stable", driver=SILENT_SKIP, driver_arg=main_py)
        self.assertIn("Restored ComfyUI source", r.stdout)
        os.chmod(main_py, stat.S_IRUSR | stat.S_IWUSR)
        # HEAD reads as the old commit over a new main.py: the launch-time check
        # sees it through tracked-changes.
        self.assertEqual(self.head(), self.sha["v1"])
        self.assertEqual(self.tracked_changes(), ["main/main.py"])
        self.assert_update_repairs()

    @NEEDS_PERMISSIONS
    def test_kill_during_restore_leaves_a_tree_update_repairs(self):
        # Desktop killed mid-restore: HEAD is already back at the old commit
        # (the restore moves refs first), the files are still the target's.
        self.lock("main")
        r = self.update("--stable", driver=KILL_IN_RESTORE, driver_arg="-")
        self.assertEqual(r.returncode, 9, r.stdout + r.stderr)
        os.chmod(os.path.join(self.repo, "main"), stat.S_IRWXU)
        self.assertEqual(self.head(), self.sha["v1"])
        self.assertIn("app/db.py", self.tracked_changes())
        self.assert_update_repairs()

    def test_update_repairs_a_tree_left_by_the_old_updater(self):
        # The previous updater went to master, then failed partway back to the
        # tag: HEAD on master, app/db.py at the tag's content.
        git(self.repo, "checkout", "-q", "-f", "master")
        with open(os.path.join(self.repo, "app", "db.py"), "w") as f:
            f.write(V2["app/db.py"])
        self.assert_update_repairs()

    def test_tracked_changes_ignores_untracked_files(self):
        self.assertEqual(self.tracked_changes(), [])
        with open(os.path.join(self.repo, "untracked.txt"), "w") as f:
            f.write("x\n")
        self.assertEqual(self.tracked_changes(), [])
        with open(os.path.join(self.repo, "app", "db.py"), "w") as f:
            f.write("edited\n")
        os.remove(os.path.join(self.repo, "only_v1.txt"))
        self.assertEqual(sorted(self.tracked_changes()), ["app/db.py", "only_v1.txt"])

if __name__ == "__main__":
    unittest.main()
