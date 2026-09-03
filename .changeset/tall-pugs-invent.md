---
"@zabloo/cli": minor
---

`zabloo dev --godot` pushes each save to a running Godot game, which hot-swaps its views
through the same loading path a platform hot-update takes — data the game pushed with
`set_data` survives the swap. The receiver is the `ZablooDevMode` autoload that enabling
the Zabloo addon installs; `--godot-port` (default `5079`) moves the port.

That push carries the envelope **without its asset bytes**, plus the address of the
preview's `/asset/<hash>` route, and the game fetches only the content hashes it does not
already hold. A save in a project with megabytes of images now moves kilobytes, and an
image is transferred once however many reloads follow.

An engine dev mode that is not listening is reported **once** instead of on every save, with
one line when it answers again. `--unity` is unchanged and still sends the whole envelope.
