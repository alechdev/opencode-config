---
name: codex-imagegen
description: >
  Generate or edit raster images by delegating to Codex CLI's bundled imagegen
  skill / built-in image_gen tool (gpt-image-2) through `codex exec`. Use when
  the user asks to create, generate, draw, edit, restyle, or make variants of
  images or binary assets (hero art, illustrations, icons exported as PNG,
  dark-mode image variants, textures, placeholders) in an agent that has shell
  access and the `codex` binary installed but no native image-generation tool.
  Also triggers on "generate an image", "make me a picture of", "edit this
  image", or when another skill requires an `imagegen` step.
slash: true
---

# Generate Images via Codex CLI

Codex ships a bundled `imagegen` skill and a server-side `image_gen` tool
(gpt-image-2). Any agent with shell access can drive it non-interactively — no
extra accounts or API keys beyond the user's ChatGPT login.

## Preconditions

```sh
codex login status                            # → "Logged in using ChatGPT"
codex features list | grep image_generation   # → image_generation  stable  true
```

- Not logged in → tell the user to run `codex login` first; do not try to authenticate yourself.
- Feature shows false → retry the call with `--enable image_generation`.

## Core invocation

One `codex exec` per task. Batch every image for the task into a single prompt —
each invocation is a fresh session billed to the user's plan (~40k tokens +
image cost).

```sh
codex exec --skip-git-repo-check \
  -C <project-dir> \
  -s workspace-write \
  -o /tmp/opencode/codex-imagegen-last.txt \
  "<prompt>"
```

| Flag | Why |
|---|---|
| `-C <project-dir>` | Sets cwd; also where relative paths resolve |
| `-s workspace-write` | Lets Codex write outputs into the project |
| `--skip-git-repo-check` | Needed outside git repos |
| `-o <file>` | Optional: captures Codex's final message |
| `--enable image_generation` | Only if the feature flag is off |

Never pass `--dangerously-bypass-approvals-and-sandbox`. Allow generous
timeouts — generation can take 1–4 minutes.

## Writing the prompt

Always structure generation prompts as:

1. **"Load and follow the imagegen skill."** — required first instruction; it
   makes Codex apply correct prompting/saving conventions instead of improvising.
2. **Subject & style** — what the image shows, art direction, palette, mood.
   Be concrete ("flat vector blue circle on white", not "a nice icon").
3. **Exact dimensions and format** — e.g. "1024x1024 PNG". The API sometimes
   ignores size requests (a 1024² ask once returned 1254×1254); Codex usually
   resizes on its own, but state it explicitly anyway.
4. **Absolute output path inside the project** — e.g. "Save it to
   /path/to/project/assets/hero.png". Codex writes raw generations under
   `$CODEX_HOME/generated_images/` and copies the final file to the path you
   name. Always name a project path so assets don't stay stranded under
   `$CODEX_HOME/*`.
5. End with a one-line confirmation format, e.g. "Reply with just: DONE <path>".

## Editing an existing image

Attach the source so it is visible in context, then describe the edit:

```sh
codex exec --skip-git-repo-check -C <project-dir> -s workspace-write \
  -i /path/to/source.png \
  "Load and follow the imagegen skill. Edit the attached image: <change>. Keep composition and dimensions exactly. Save to <project-dir>/<name>-edited.png"
```

For derived variants (e.g. dark-mode versions), spell out what must be
preserved: composition, blurs/softness, fades, foreground hues — adjust only
the background/lightness unless told otherwise.

## Verify afterwards

1. File exists at the requested path (`ls`).
2. Dimensions/format match what was asked (`file <out>.png`, or ImageMagick
   `identify` if installed).
3. Actually view/read the result before declaring success — confirm subject,
   style, and any preservation constraints.
4. If Codex left the asset only under `$CODEX_HOME/generated_images/`, copy it
   into the project and reference that path.

## Cost discipline

- Batch multiple images into one prompt; avoid chatty multi-round sessions.
- Prefer small sizes during iteration (512px drafts), regenerate finals at full size only when needed.
- If generation fails repeatedly (quota, rate limit), report the error to the user instead of retrying in a loop.
