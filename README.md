# zabloo/ui

> **shadcn/ui for game engines** — author your UI once, compile it to native UI for
> Unity, Godot and Unreal. Copy-paste, you own the code.

`zabloo/ui` is the open-source pipeline that turns a single, engine-agnostic UI
description into native UI for each game engine.

```
authoring (React/JSX + tokens) → IR → per-engine plugin → native UI
```

- **Core (TypeScript):** normalizes authoring into the **IR**, a single engine-agnostic
  JSON (tokens resolved, style computed per node).
- **Plugins (one per engine):** read the IR and generate native UI — Unity (C#),
  Godot (GDScript/C#), Unreal (C++).
- **Golden rule:** the core never knows about any specific engine.

## Status

🚧 **Early foundations.** We are designing the **IR** (the keystone of the system) before
writing production code. In v1 only **Unity** produces output; Godot and Unreal are being
designed in parallel.

## How it will work

The primary workflow is **local code + CLI**:

```bash
zabloo build        # authoring → IR → native UI for your engine
```

A component showcase/registry (à la ui.shadcn.com) and a web playground will come later.

## License

Open source and free: core, IR, CLI, authoring, the three engine plugins and the base
component library.
