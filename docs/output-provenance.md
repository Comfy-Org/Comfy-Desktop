# Output provenance for Desktop Assets

[DESK-361](https://linear.app/comfyorg/issue/DESK-361/assets-filtering-by-instance-shows-the-same-assets-for-every-instance) asks which outputs a build generated. Two independently installed builds can use the same `--output-directory`. A file discovered there establishes its location. The producing build is known at the save.

## Decision

Record the producing build in Core as part of publishing a file. Desktop passes its stable installation ID and a per-build journal directory to managed Core launches. A build rename, update, port change, or restart keeps the same ID. Core uses the current node’s prompt ID and captures the file identity after the encoder closes its staged file.

For an ordinary numbered save, Core publishes the staged file at the requested name if it is free. A concurrent save that chose the same name gets a distinct name, which Core returns to the workflow. A writer with an explicit overwrite mode can replace the destination atomically. Native media savers and the shared image and audio helpers use this contract. Custom savers can call `comfy_api.latest.ui.output_file`. Cached deliveries, directory scans, and ordinary file copies create no producer record.

## Durability and file identity

Each Core process appends to its own v1 JSON Lines journal in Desktop’s state directory. Core syncs the record before publishing the staged file. Desktop accepts it when the live file matches the recorded device, file ID, byte size, and nanosecond modification time. A record from an interrupted publish therefore has no matching file. A replacement by another writer has its own file identity, even when the name, bytes, and modification time match the previous save. A journal write failure leaves the media save available with unknown origin.

Desktop reads complete records incrementally and retains the byte offsets for the lifetime of its process. It can rebuild the index from the journal with every Core process stopped. Per-build listing checks journal paths within the configured local output roots and retains the gallery’s existing result limit. Versioned card IDs carry the checked file revision through preview and file actions. Downloads verify the opened handle when the transfer begins, including after time spent in the save dialog. Reveal and Trash use the OS path APIs after a fresh check.

## Why this boundary

| Approach                                | Consequence                                                                                                                                                                                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browse output folders                   | Useful for every local file, including imports and existing libraries. Build folders can share one location. [DESK-344](https://linear.app/comfyorg/issue/DESK-344/rework-assets-filtering-per-folder) covers this navigation.                           |
| Assign a dedicated folder to each build | Gives Desktop a folder filter through existing launch arguments. Changes the saved paths for users who rely on a shared output location.                                                                                                                 |
| Correlate `/history` and timestamps     | Works with older Core builds and captures many saves. Overlapping runs can refer to the same path, and an uncaptured run disappears from history on restart. [Desktop #2172](https://github.com/Comfy-Org/Comfy-Desktop/pull/2172) explores this option. |
| Query the Core asset catalog            | Core’s HTTP API is available while that server runs and the asset catalog is enabled. A job ID also appears on cached deliveries. Direct SQLite access couples Desktop to Core’s schema and migrations.                                                  |
| Publish a versioned save journal        | Preserves shared paths and supports stopped builds through a small local contract. Requires participating writers and a filesystem whose file identity both runtimes can verify.                                                                         |

## Compatibility and rollout

Older Core versions ignore the launch environment variables. Desktop shows only verified writes under a build and provides **This computer** for existing, imported, and unreported files. The viewer shows the saved local path or the Cloud API’s path when supplied. The gallery hides raw tags, including Desktop’s former synthetic `output` tag. Cloud listing continues to use workspace scope.

The contract covers writes that use the helper and remain at a recorded path in a configured output root. Files moved or copied to another path can be browsed under **This computer** if that location is configured. Filesystems that cannot provide a matching file ID, or that change it on publication or remount, leave the producer unknown. The revision check is for ordinary file replacement. It is possible for external software to modify a file in place and deliberately restore its size and modification time. Full media hashing would add an extra read of every output’s bytes. The journal stores metadata only and grows with the number of saves.

Ship a managed Core version with journal support before releasing the per-build filter. Verify both filters against two real builds sharing one folder, including concurrent generated names, a cache replay, and an intentional overwrite. Stop both servers, relaunch Desktop, and verify that the live outputs retain their producers and that the untracked file remains visible through **This computer**.
