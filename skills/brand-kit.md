---
name: Brand Kit
description: Generate a visual brand direction board for a product idea, including marketing-site mockups, typography, and color guidance.
slash: true
---

# Brand Kit

Read and follow `ui-design/direction/brand-kit-prompt.md`, using the user's slash-command arguments as the product brief.

Follow its **Rendering** section: load the available image-generation skill (`codex-imagegen` in OpenCode, or `imagegen` when running inside Codex), generate exactly one brand board, and return the resulting image with minimal commentary. Do not stop at the intermediate prompt unless image generation is unavailable or the user explicitly asks for prompt text only.
