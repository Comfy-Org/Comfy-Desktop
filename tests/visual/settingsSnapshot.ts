import type GlobalSettingsView from '../../src/renderer/src/comfyTitlePopup/GlobalSettingsView.vue'

type Snapshot = InstanceType<typeof GlobalSettingsView>['$props']['snapshot']

export const settingsSnapshot: Snapshot = {
  languageFields: [],
  generalFields: [
    {
      id: 'language',
      label: 'Language',
      value: 'en',
      editable: true,
      editType: 'select',
      options: [
        { value: 'en', label: 'English' },
        { value: 'zh', label: '中文' }
      ]
    }
  ],
  telemetryFields: [
    {
      id: 'telemetryEnabled',
      label: 'Send anonymous telemetry',
      value: true,
      editable: true,
      editType: 'boolean'
    },
    {
      id: 'betaFeaturesEnabled',
      label: 'Opt-in to beta features',
      value: false,
      editable: true,
      editType: 'boolean'
    }
  ],
  telemetryGranted: true,
  desktopUpdateFields: [],
  cacheFields: [],
  advancedFields: [],
  sharedDirectoriesFields: [],
  installLocationFields: [
    {
      id: 'installDir',
      label: 'Install Location',
      value: '/ComfyUI/Installations',
      editable: true,
      editType: 'path',
      openable: true,
      browseOnly: true
    }
  ],
  modelsDirs: [
    { path: '/ComfyUI/models', isPrimary: true },
    { path: '/Volumes/Models', isPrimary: false }
  ],
  modelsSystemDefault: '/ComfyUI/models',
  appUpdate: {
    state: { kind: null, version: null, autoUpdate: true },
    progress: null,
    isDownloading: false,
    capabilities: { systemManaged: false, canSelfUpdate: true },
    installedVersion: '1.1.9',
    platform: 'darwin',
    lastCheckedAt: null
  },
  githubUrl: 'https://github.com/Comfy-Org/ComfyUI',
  githubStars: 120000,
  githubStarsLoading: false,
  i18n: {
    overview: 'General',
    updates: 'Updates',
    storage: 'Storage',
    models: 'Models',
    advanced: 'Advanced',
    logs: 'Logs',
    sharedDirectories: 'Shared directories'
  }
}
