---
"@zabloo/cli": minor
---

**Breaking:** `zabloo dev --port` is now `--unity-port` (default still `5077`), the mirror of `--godot-port`. Update any script that passed `--port`.

`zabloo dev --unity` pushes each save to the Unity editor's dev mode (menu **Zabloo → Dev Mode** in the rebuilt SDK), which rewrites and reimports the `.json` asset the scene's views reference and, while playing, hot-swaps them through the same loading path a platform hot-update takes. The push now carries the envelope **without its asset bytes**, exactly like `--godot`: the editor fetches only the content hashes it does not already hold, so an image is transferred once however many reloads follow. `--godot --unity` pushes to both.
