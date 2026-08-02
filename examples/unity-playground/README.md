# unity-playground

Unity project used to develop and test the zabloo SDK (`sdk/unity`) — the vertical
slice renders here.

## Setup (once, with the Unity editor installed)

1. Create a Unity project **in this folder** (Unity Hub → New project → 2D/URP core,
   location: this directory). Unity 2022.3 LTS or newer (Unity 6 recommended).
2. Reference the SDK by local path — add to `Packages/manifest.json`:

   ```json
   "com.zabloo.sdk": "file:../../../sdk/unity"
   ```

3. Commit `Assets/`, `Packages/` and `ProjectSettings/` (the `.gitignore` here already
   excludes `Library/` and other generated folders).
