"""Real-pygit2 tests: lib/update_comfyui.py must not delete untracked files a
user keeps inside the ComfyUI checkout, while the backup branch still captures
edits to tracked files.

Run: python -m unittest discover -s tests/python
"""

import os
import shutil
import subprocess
import sys
import tempfile
import unittest

UPDATE = os.path.join(os.path.dirname(__file__), "..", "..", "lib", "update_comfyui.py")

# ComfyUI's real ignore rules: the user folders in these tests (outputs/,
# my_models/) are deliberately near-misses that git doesn't ignore.
IGNORE = "/output/\n/models/\n"
V1 = {"main.py": "v1\n", "app/db.py": "v1\n", "README.md": "v1\n", ".gitignore": IGNORE}
V2 = {"main.py": "v2\n", "app/db.py": "v2\n", "README.md": "v2\n", ".gitignore": IGNORE,
      "collide.txt": "from v2\n"}
GIT_ENV = dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1")


def git(cwd, *args, check=True):
    return subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=master",
         *args],
        cwd=cwd, check=check, capture_output=True, text=True, env=GIT_ENV,
    ).stdout.strip()


def write(root, files):
    for rel, content in files.items():
        path = os.path.join(root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(content)


def read(root, rel):
    with open(os.path.join(root, rel)) as f:
        return f.read()


class UpdateKeepsUntrackedTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        src = os.path.join(self.tmp, "src")
        os.makedirs(src)
        git(src, "init")
        for tag, files in (("v1.0.0", V1), ("v2.0.0", V2)):
            write(src, files)
            git(src, "add", "-A")
            git(src, "commit", "-m", tag)
            git(src, "tag", tag)
        origin = os.path.join(self.tmp, "origin.git")
        git(self.tmp, "clone", "--bare", src, origin)
        self.repo = os.path.join(self.tmp, "ComfyUI")
        git(self.tmp, "clone", origin, self.repo)
        git(self.repo, "checkout", "v1.0.0")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def update(self):
        result = subprocess.run(
            [sys.executable, UPDATE, self.repo, "--tag", "v2.0.0"],
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(git(self.repo, "rev-parse", "HEAD"), git(self.repo, "rev-parse", "v2.0.0"))
        return result.stdout

    def backup_branch(self, stdout):
        return next(line.split(" ", 1)[1] for line in stdout.splitlines()
                    if line.startswith("[BACKUP_BRANCH] "))

    def test_untracked_user_files_survive(self):
        user_files = {
            "outputs/ComfyUI_00001_.png": "image\n",
            "notes.txt": "hand-dropped\n",
            "my_models/checkpoints/model.safetensors": "weights\n",
        }
        write(self.repo, user_files)
        self.update()
        for rel, content in user_files.items():
            self.assertEqual(read(self.repo, rel), content, rel)
        self.assertEqual(read(self.repo, "main.py"), "v2\n")

    def test_backup_branch_captures_tracked_edits(self):
        write(self.repo, {"main.py": "user edit\n", "outputs/a.png": "image\n"})
        os.remove(os.path.join(self.repo, "app", "db.py"))
        backup = self.backup_branch(self.update())
        self.assertEqual(git(self.repo, "show", "%s:main.py" % backup), "user edit")
        files = git(self.repo, "ls-tree", "-r", "--name-only", backup).splitlines()
        self.assertNotIn("app/db.py", files)
        self.assertIn("outputs/a.png", files)
        self.assertEqual(read(self.repo, "main.py"), "v2\n")

    def test_backup_branch_resolves_an_unfinished_merge(self):
        git(self.repo, "checkout", "-b", "theirs")
        write(self.repo, {"main.py": "theirs\n", "app/db.py": "theirs\n"})
        git(self.repo, "commit", "-am", "theirs")
        git(self.repo, "checkout", "-b", "mine", "v1.0.0")
        write(self.repo, {"main.py": "mine\n"})
        git(self.repo, "rm", "-q", "app/db.py")
        git(self.repo, "commit", "-am", "mine")
        git(self.repo, "merge", "theirs", check=False)
        self.assertIn("UU main.py", git(self.repo, "status", "--short"))
        os.remove(os.path.join(self.repo, "app", "db.py"))
        write(self.repo, {"README.md": "user edit\n"})
        backup = self.backup_branch(self.update())
        self.assertIn("<<<<<<<", git(self.repo, "show", "%s:main.py" % backup))
        files = git(self.repo, "ls-tree", "-r", "--name-only", backup).splitlines()
        self.assertNotIn("app/db.py", files)
        self.assertEqual(git(self.repo, "show", "%s:README.md" % backup), "user edit")

    @unittest.skipIf(os.name == "nt", "the updater disables symlinks on Windows")
    def test_backup_branch_captures_a_symlink_replaced_by_a_file(self):
        git(self.repo, "checkout", "-b", "local")
        os.symlink("main.py", os.path.join(self.repo, "link.py"))
        git(self.repo, "add", "link.py")
        git(self.repo, "commit", "-m", "link")
        os.remove(os.path.join(self.repo, "link.py"))
        write(self.repo, {"link.py": "user edit\n"})
        backup = self.backup_branch(self.update())
        self.assertEqual(git(self.repo, "show", "%s:link.py" % backup), "user edit")

    def test_untracked_file_at_a_newly_tracked_path_is_only_in_the_backup(self):
        # The forced checkout replaces an untracked file at a path the target
        # commit starts tracking; the backup branch keeps the user's copy.
        write(self.repo, {"collide.txt": "user file\n"})
        backup = self.backup_branch(self.update())
        self.assertEqual(read(self.repo, "collide.txt"), "from v2\n")
        self.assertEqual(git(self.repo, "show", "%s:collide.txt" % backup), "user file")


if __name__ == "__main__":
    unittest.main()
