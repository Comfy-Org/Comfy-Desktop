/**
 * Default display name for a newly created ComfyUI instance.
 *
 * Every create / track / migrate / duplicate flow starts from this stem and
 * lets `uniqueName()` append " (N)" on conflict, so installs read as "ComfyUI",
 * "ComfyUI (1)", … Keep the name plain: no install type, source label, or
 * version. That metadata is shown elsewhere and only goes stale inside the name.
 */
export const DEFAULT_INSTALL_NAME = 'ComfyUI'
