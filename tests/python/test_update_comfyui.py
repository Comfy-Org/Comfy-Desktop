"""Real-pygit2 tests for lib/update_comfyui.py and the rollback checkout in
lib/git_operations.py, against a local origin with a master + tags layout.

A mid-checkout write failure is forced with a read-only directory, standing in
for a file held open by antivirus or another process on Windows.

Run: python -m unittest discover -s tests/python
"""

import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest

LIB = os.path.join(os.path.dirname(__file__), "..", "..", "lib")
UPDATE = os.path.join(LIB, "update_comfyui.py")
GIT_OPS = os.path.join(LIB, "git_operations.py")

# Runs update_comfyui.py, and when a checkout fails, makes argv[1] (a file) and
# its directory read-only: a file the update just wrote gets locked before the
# restore can rewrite it.
LOCK_ON_FAILURE = """
import os, runpy, stat, sys, pygit2
lock_file = sys.argv.pop(1)
sys.argv.pop(0)  # "-c": the script then sees its usual argv
real = pygit2.Repository.checkout_tree
def checkout_tree(self, *args, **kwargs):
    try:
        return real(self, *args, **kwargs)
    except Exception:
        os.chmod(lock_file, stat.S_IRUSR)
        os.chmod(os.path.dirname(lock_file), stat.S_IRUSR | stat.S_IXUSR)
        raise
pygit2.Repository.checkout_tree = checkout_tree
sys.path.insert(0, os.path.dirname(sys.argv[0]))
runpy.run_path(sys.argv[0], run_name="__main__")
"""

# Path order matters: libgit2 writes app/ before main/, so a failure in main/
# lands after app/db.py has already been written, as in the field crash.
V1 = {"app/db.py": "v1\n", "main/main.py": "v1\n", "only_v1.txt": "x\n"}
V2 = {"app/db.py": "v2\n", "main/main.py": "v2\n", "main/extra.py": "v2\n"}
MASTER = {"app/db.py": "m\n", "main/main.py": "m\n", "main/extra.py": "m\n",
          "only_master.txt": "m\n"}


def git(cwd, *args):
    return subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-C", cwd, *args],
        check=True, capture_output=True, text=True,
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


@unittest.skipIf(hasattr(os, "geteuid") and os.geteuid() == 0,
                 "root ignores the read-only directory used to force a failure")
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

    def update(self, *args, lock_on_failure=None):
        driver = ["-c", LOCK_ON_FAILURE, lock_on_failure] if lock_on_failure else []
        return subprocess.run([sys.executable, *driver, UPDATE, self.repo, *args],
                              capture_output=True, text=True)

    def git_ops_checkout(self, commit, *flags):
        return subprocess.run([sys.executable, GIT_OPS, "checkout", self.repo,
                               commit, *flags], capture_output=True, text=True)

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
        self.assert_clean_at(self.sha["v1"], V1)

    def test_local_changes_are_kept_on_the_backup_branch(self):
        with open(os.path.join(self.repo, "app", "db.py"), "w") as f:
            f.write("edited\n")
        r = self.update("--stable")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assert_clean_at(self.sha["v2"], V2)
        backup = git(self.repo, "branch", "--list", "backup_branch_*",
                     "--format=%(refname:short)")
        self.assertEqual(git(self.repo, "show", "%s:app/db.py" % backup), "edited")

    def test_failed_checkout_restores_the_install(self):
        # main/extra.py (target only) sorts first in main/ and cannot be
        # created, so main/main.py is never touched and the restore succeeds.
        self.lock("main")
        r = self.update("--stable")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("Restored ComfyUI source to pre-update commit", r.stdout)
        self.assertEqual(git(self.repo, "rev-parse", "--abbrev-ref", "HEAD"), "HEAD")
        self.assertEqual(git(self.repo, "rev-parse", "master"), self.sha["v1"])
        self.assert_clean_at(self.sha["v1"], V1)

    def test_failed_restore_leaves_head_moved_and_rollback_repairs(self):
        # The update writes app/db.py, fails in main/, and app/ is locked
        # before the restore can put app/db.py back: the field's mixed tree.
        main_dir = self.lock("main")
        app_dir = os.path.join(self.repo, "app")
        self.addCleanup(os.chmod, app_dir, stat.S_IRWXU)
        r = self.update("--stable", lock_on_failure=os.path.join(app_dir, "db.py"))
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("Failed to restore pre-update state", r.stdout)
        tree = read_tree(self.repo)
        self.assertEqual((tree["app/db.py"], tree["main/main.py"]), ("v2\n", "v1\n"))
        # HEAD must not read as the pre-update commit over a mixed tree, or
        # Desktop would treat the install as healthy and skip the rollback.
        self.assertNotEqual(self.head(), self.sha["v1"])

        os.chmod(main_dir, stat.S_IRWXU)
        os.chmod(app_dir, stat.S_IRWXU)
        os.chmod(os.path.join(app_dir, "db.py"), stat.S_IRUSR | stat.S_IWUSR)
        repaired = self.git_ops_checkout(self.sha["v1"], "--force")
        self.assertEqual(repaired.returncode, 0, repaired.stderr)
        self.assert_clean_at(self.sha["v1"], V1)

    def test_forced_rollback_repairs_a_tree_left_by_the_old_updater(self):
        # The old updater went to master first, then failed partway back to
        # the tag: HEAD on master, app/db.py at the tag, main/main.py master's.
        git(self.repo, "checkout", "-q", "-f", "master")
        git(self.repo, "reset", "-q", "--hard", self.sha["master"])
        with open(os.path.join(self.repo, "app", "db.py"), "w") as f:
            f.write(V2["app/db.py"])
        refused = self.git_ops_checkout(self.sha["v1"])
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn("conflict", refused.stderr)
        repaired = self.git_ops_checkout(self.sha["v1"], "--force")
        self.assertEqual(repaired.returncode, 0, repaired.stderr)
        self.assert_clean_at(self.sha["v1"], V1)


if __name__ == "__main__":
    unittest.main()
