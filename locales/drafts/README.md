# Draft Translations

These locale files are **not actively maintained** and may be missing keys or
contain outdated strings compared to the primary `en.json` locale.

They are kept here as a starting point for future translation work. To activate
a translation, bring its file up to date with `en.json` (ensure all keys are
present and correctly translated), then move it back into the parent `locales/`
directory. The launcher auto-discovers any `.json` file in `locales/`.

## Placeholder contract

Some strings interpolate a value, written `{likeThis}`. A placeholder is **not
always a word of the sentence's own language**, and translating around one
requires knowing which kind it is.

### `{feature}` — the beta-notice keys

`titleBar.betaNoticeTitleNamed`, `titleBar.betaNoticeBodyNamed`,
`titleBar.betaNoticeOffTitleNamed` and `titleBar.betaNoticeOffBodyNamed`
interpolate `{feature}`:
the name of a beta feature, e.g. `Asset library`.

It is an **opaque proper name**. It is supplied at runtime by a remote
configuration payload, it is the same string for every user regardless of
locale, and it is **English today**. Desktop cannot translate it and cannot
know its grammatical gender or number.

So, when translating these four strings:

- **Keep `{feature}` a modifier, never the grammatical head.** In English it
  modifies a constant head noun — "The *{feature}* **beta** is on" — and it is
  that head noun ("beta") the sentence agrees with. Keep an equivalent constant
  head in your language and let it carry the agreement: *la bêta {feature}*,
  *die {feature}-Beta*, *бета-функция {feature}*.
- **Do not make the sentence agree with, decline, or inflect `{feature}`.** A
  form like "{feature} est activé" or "{feature} включён" needs the name's
  gender, which is unknowable — it would be guessing, and the guess changes
  whenever ops names a new feature.
- **Word order is yours.** Putting the name after the head noun instead of
  before it is expected, not a problem.
- An article immediately before `{feature}` should agree with the head noun,
  not with the name.

If your language cannot express this without inflecting the name, say so rather
than picking a gender — the template needs changing, not the translation.
