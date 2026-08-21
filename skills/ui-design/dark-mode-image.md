# Dark Mode Image

Use when adapting a standalone source image into a dark-mode-suitable version.

> **Model requirement:** the image-generation steps need the `imagegen` skill (Codex, gpt-image-2). Agents running inside Codex have it natively. Agents without it but with shell access can delegate to the Codex CLI — see [Delegating to the Codex CLI](#delegating-to-the-codex-cli). Only when that isn't possible either (no `codex` binary, not logged in, no shell), identify the images needing dark variants, list them with target background colors, and ask the user to generate them or source dark versions manually. Never substitute CSS filter workarounds.

## Delegating to the Codex CLI

If this agent lacks a native `imagegen` skill but has shell access, run the generation inside a non-interactive Codex session. Codex loads its own bundled `imagegen` skill, so all rules in this document still apply.

Preconditions:

```sh
codex login status                            # → "Logged in using ChatGPT"
codex features list | grep image_generation   # → image_generation  stable  true
```

One `codex exec` per task; batch every requested image into a single prompt (each invocation is a fresh session billed to the user's plan, ~40k tokens + image cost):

```sh
codex exec --skip-git-repo-check \
  -C <project-dir> \
  -s workspace-write \
  -o /tmp/opencode/codex-imagegen-last.txt \
  "Load and follow the imagegen skill. Create the dark-mode version of <source-path>: invert the background (<color>), preserving composition, softness, fades, and foreground hues. Output must be exactly <W>x<H>, saved to <project-dir>/<name>-dark.<ext>"
```

Field notes (from a live test):

- Codex writes raw generations under `$CODEX_HOME/generated_images/` and copies the final file to the absolute path given in the prompt — always name a path inside the project so the save-path policy above holds.
- Ask for exact dimensions in the prompt; the API sometimes ignores them (a 1024×1024 request came back 1254×1254) and Codex resizes on its own, but verify afterwards anyway.
- Flags: `-C` sets cwd, `-s workspace-write` lets it write into the project, `--skip-git-repo-check` allows non-repo dirs. Allow 2–4 min timeouts. Never pass `--dangerously-bypass-approvals-and-sandbox`.

Then verify as usual: the file exists at the project path, dimensions match the original exactly (`file` or ImageMagick `identify`), and visually confirm composition, softness, fades, and foreground palette before wiring the asset in.

## Load First

- Before any image generation or editing, load and follow the `imagegen` skill.

## Workflow

1. Load `imagegen`.
2. Inspect the source image and the dark-mode UI context.
3. Generate or edit a dark-mode version at the original's dimensions.
4. Save it with a `-dark` suffix alongside the original.
5. Return the saved project path for the caller to wire in.

## Rules

- You MUST load and follow `imagegen` before any image generation or editing: not optional. Do not skip it, replace it with an ad hoc workflow, or call image tooling directly first. Let `imagegen` choose the workflow; for normal dark-mode variants that usually means its default built-in `image_gen` tool mode
- If the source is a local file, follow `imagegen`'s local-image guidance before editing so the image is visible in the conversation context
- Follow `imagegen`'s save-path policy: move or copy project-bound generated outputs into the workspace; never leave a project-referenced dark-mode asset only under `$CODEX_HOME/*`
- Choose a background color that feels like an appropriate inversion of the original background: black or dark gray for white, dark gray for off-white, or the specific dark color the user provides; if the original background matched the site background, match the dark-mode site background instead
- Preserve the original contrast characteristics: light sections become darker while relative separation and readability stay intact
- Preserve blurs and softness; never sharpen anything that was blurry in the original
- Preserve foreground palette hues, adjusting saturation and lightness only as needed so the image presents correctly on a dark background
- Preserve the original vibe: bright and intense stays bright and intense, subtle and muted stays subtle and muted
- Preserve fades: watch areas that fade out and keep those fades in the dark-mode version
- The dark-mode image must be exactly the same dimensions as the original
- Save dark-mode images with a `-dark` suffix, e.g. `bg.jpg` and `bg-dark.jpg`

## Verify

- Generated image dimensions match the original exactly.
- The dark-mode image preserves the original composition, softness, fades, and foreground palette.
