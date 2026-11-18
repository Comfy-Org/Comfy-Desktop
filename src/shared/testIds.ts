export const TID = {
  pickerRow: (installId: string) => `picker-row-${installId}`,
  pickerNewWindow: 'picker-new-window',
  pickerPrimaryCta: 'picker-primary-cta',
  pickerMoreTrigger: 'picker-more-trigger',
  pickerSettingsLoading: 'picker-settings-loading',
  pickerSettingsSections: 'picker-settings-sections',
  pickerOpErrorMessage: 'picker-op-error-message',
  pickerOpErrorCopy: 'picker-op-error-copy',

  dashboardTile: (installId: string) => `dashboard-tile-${installId}`,
  dashboardTileKebab: (installId: string) => `dashboard-tile-kebab-${installId}`,
  dashboardTileWhyCloud: (installId: string) => `dashboard-tile-why-cloud-${installId}`,

  contextMenuItem: (id: string) => `context-menu-item-${id}`,

  modalConfirm: 'modal-confirm-button',
  modalCancel: 'modal-cancel-button',
  modalPromptInput: 'modal-prompt-input',
  baseAlertAction: 'base-alert-action',
  baseAlertCancel: 'base-alert-cancel',
  basePromptInput: 'base-prompt-input',
  basePromptAction: 'base-prompt-action',
  basePromptCancel: 'base-prompt-cancel',
  deleteConfirmModal: 'delete-confirm-modal',
  deleteConfirmButton: 'delete-confirm-button',

  updateChannelCard: (channel: string) => `update-channel-card-${channel}`,
  updateActionButton: (actionId: string) => `update-action-${actionId}`,
  channelGroupSelect: (level: number) => `channel-group-select-${level}`,
  buildOverviewChannel: 'build-overview-channel',
  buildOverviewChannelOption: (channel: string) => `build-overview-channel-${channel}`,
  buildOverviewUpdateMenu: 'build-overview-update-menu',
  buildOverviewPytorchChange: 'build-overview-pytorch-change',
  buildOverviewPytorchOption: (stackId: string) => `build-overview-pytorch-${stackId}`,

  settingsTab: (key: string) => `settings-tab-${key}`,

  pinBottomAction: (actionId: string) => `pin-bottom-action-${actionId}`,

  snapshotsSaveCta: 'snapshots-save-cta',
  snapshotRow: (filename: string) => `snapshot-row-${filename}`,
  snapshotRowRestore: (filename: string) => `snapshot-row-restore-${filename}`,
  snapshotRowExport: (filename: string) => `snapshot-row-export-${filename}`,
  snapshotRowMore: (filename: string) => `snapshot-row-more-${filename}`,
  snapshotRowDelete: (filename: string) => `snapshot-row-delete-${filename}`,
  snapshotsImport: 'snapshots-import',
  snapshotsExportAll: 'snapshots-export-all',
  snapshotsOpCard: 'snapshots-op-card',
  snapshotsOpCardCancel: 'snapshots-op-card-cancel',
  snapshotsOpCardRetry: 'snapshots-op-card-retry',
  snapshotsOpCardDismiss: 'snapshots-op-card-dismiss',

  lifecycleRelaunch: 'lifecycle-relaunch',
  lifecycleReturnDashboard: 'lifecycle-return-dashboard',

  consoleTerminal: 'console-terminal',
  consoleSessionEnded: 'console-session-ended',
  consoleRestart: 'console-restart',

  progressErrorMessage: 'progress-error-message',
  progressLogs: 'progress-logs',
  progressReboot: 'progress-reboot',
  progressBack: 'progress-back',
  trackBrowse: 'track-browse',
  progressPortConflictBanner: 'progress-port-conflict-banner',
  progressPortConflictUsePort: 'progress-port-conflict-use-port',
  progressPortConflictKill: 'progress-port-conflict-kill',

  installShowcase: 'install-showcase',
  installShowcaseTitle: 'install-showcase-title',
  installShowcaseCloud: 'install-showcase-cloud'
} as const

export type TestIdKey = keyof typeof TID
