# Output provenance for Desktop Assets

[DESK-361](https://linear.app/comfyorg/issue/DESK-361/assets-filtering-by-instance-shows-the-same-assets-for-every-instance) asks which outputs a build generated. Two independently installed builds can use the same `--output-directory`. A file discovered there establishes its location. The producing build is known at the save.

## Decision

Per-build attribution needs a compatibility contract that survives Core upgrades and makes unreadable records visible. A published read-only SQLite view could meet that requirement with version checks and migration tests. The local journal keeps attribution available across the catalog’s enablement and recovery paths, including when Desktop starts a build with the catalog disabled.

Record the producing build in Core when a node returns a file as its output. Desktop passes its stable installation ID and a per-build journal directory to managed Core launches. A build rename, update, port change, or restart keeps the same ID. Core already resolves every file in a node’s result to register it with the asset catalog. The same step records the prompt ID and the identity of the file it finds on disk.

Every node that reports its saved files to the UI is covered, custom nodes included, with no change to save code. Cached deliveries, directory scans, and ordinary file copies create no producer record. Two builds that save to one path at the same moment can both record the file that survives. Desktop leaves a file revision that more than one build recorded out of every build’s view, and it stays under **This computer**.

## Durability and file identity

Each Core process appends to its own v1 JSON Lines journal in Desktop’s state directory. Core syncs the record before it reports the node’s result. Desktop accepts it when the live file matches the recorded device, file ID, byte size, and nanosecond modification time. A Core process that exits between a save and the node’s return leaves that file with unknown origin. A later save to the same path changes the recorded identity, so the earlier record stops matching. A replacement by rename has its own file ID, even when the name, bytes, and modification time match the previous save. A journal write failure leaves the media save available with unknown origin.

Desktop reads complete records incrementally and retains the byte offsets for the lifetime of its process. It can rebuild the index from the journal with every Core process stopped. Unsupported record versions, malformed complete records, and journal read errors produce an explicit warning. Desktop still shows verified results and links to **This computer** for browsing by location. Per-build listing checks journal paths within the configured local output roots and retains the gallery’s existing result limit. Versioned card IDs carry the checked file revision through preview and file actions. Downloads verify the opened handle when the transfer begins, including after time spent in the save dialog. Reveal and Trash use the OS path APIs after a fresh check.

## Why this boundary

| Approach                                | Consequence                                                                                                                                                                                                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browse output folders                   | Useful for every local file, including imports and existing libraries. Build folders can share one location. [DESK-344](https://linear.app/comfyorg/issue/DESK-344/rework-assets-filtering-per-folder) covers this navigation.                                 |
| Assign a dedicated folder to each build | Gives Desktop a folder filter through existing launch arguments. Changes the saved paths for users who rely on a shared output location.                                                                                                                       |
| Correlate `/history` and timestamps     | Works with older Core builds and captures many saves. Overlapping runs can refer to the same path, and an uncaptured run disappears from history on restart. [Desktop #2172](https://github.com/Comfy-Org/Comfy-Desktop/pull/2172) explores this option.       |
| Query the Core asset catalog            | A versioned SQL view can support offline readers when a build uses a persistent catalog. Coverage depends on the catalog being available when the save happens. A job ID can also appear on a cached delivery, so the catalog needs new write-time provenance. |
| Publish a versioned save journal        | Preserves shared paths and supports stopped builds through a small local contract. Requires a filesystem whose file identity both runtimes can verify. A file two builds both recorded has unknown origin.                                                     |

## Compatibility and rollout

Older Core versions ignore the launch environment variables. Desktop shows only verified writes under a build and provides **This computer** for existing, imported, and unreported files. The viewer shows the saved local path or the Cloud API’s path when supplied. The gallery hides raw tags, including Desktop’s former synthetic `output` tag.

The contract covers files a node reports in its result that remain at the recorded path in a configured output root. Files moved or copied to another path can be browsed under **This computer** if that location is configured. Filesystems that cannot provide a matching file ID, or that change it on publication or remount, leave the producer unknown. The revision check is for ordinary file replacement. It is possible for external software to modify a file in place and deliberately restore its size and modification time. Full media hashing would add an extra read of every output’s bytes. The journal stores metadata only and grows with the number of saves.

Ship a managed Core version with journal support before releasing the per-build filter. An earlier macOS verification used two CPU-only Core processes with the asset catalog disabled, against a Core revision that journaled from a save helper. Repeat it against the revision that journals from the node result before release: two builds saving with the same prefix, a cache replay, a custom-node saver, and a same-path collision. The committed Desktop end-to-end test exercises the stopped-build filters, the saved path, and the untracked fallback.
