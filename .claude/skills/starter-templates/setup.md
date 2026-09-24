# First-time setup

Everything below is one-time. After it, changing a template is one sentence to
Claude.

## What you need

**Node 22+** — check with `node --version`. If it's missing or older, install
from [nodejs.org](https://nodejs.org) (take the LTS build).

**The repo:**

```bash
git clone https://github.com/Comfy-Org/Comfy-Desktop.git
cd Comfy-Desktop
```

You do **not** need to install dependencies or build the app. The template
script runs on Node alone.

**GitHub CLI**, so Claude can open the PR for you:

```bash
gh auth login
```

Pick GitHub.com, HTTPS, and authenticate in the browser.

## Check it works

```bash
node scripts/starter-templates.mjs validate
```

Expected:

```
  ✓ 16 templates, 4 per tab, rules hold
```

If you see that, you are done.

## Using it

Open Claude Code in the repo folder and ask in plain English:

> swap the recommended video template to Wan 2.2

Claude finds the id, makes the change, validates it, and opens a PR for review.
You can also run `/starter-templates` to invoke it directly.

You never edit JSON by hand. You only ever choose which template goes where.

## If something goes wrong

**`node: command not found`** — Node is not installed, or the terminal needs
reopening after installing it.

**`could not read the template index`** — no internet, or GitHub is blocked.
The script reads the live template list from raw.githubusercontent.com.

**`"<id>" is not in the template index`** — that template id does not exist
upstream. Run `node scripts/starter-templates.mjs list --modality video` to see
what is available.

**Anything else** — paste the error into Claude Code. The messages are written
to say what to do next.
