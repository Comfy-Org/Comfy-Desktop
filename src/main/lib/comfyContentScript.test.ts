/// <reference lib="dom" />
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getModelDownloadContentScript } from './comfyContentScript'

describe('getModelDownloadContentScript', () => {
  const script = getModelDownloadContentScript()

  it('returns a non-empty string', () => {
    expect(script).toBeTruthy()
    expect(typeof script).toBe('string')
    expect(script.length).toBeGreaterThan(0)
  })

  it('wraps the script in an IIFE', () => {
    expect(script.startsWith('(function()')).toBe(true)
  })

  it('contains the guard against double injection', () => {
    expect(script).toContain('__comfyDesktop2Injected')
  })

  it('contains the BADGE_TO_DIR mapping with expected directory names', () => {
    expect(script).toContain('BADGE_TO_DIR')
    for (const dir of ['vae', 'diffusion_models', 'text_encoders']) {
      expect(script).toContain(dir)
    }
  })

  it('contains MutationObserver for dialog detection', () => {
    expect(script).toContain('MutationObserver')
  })

  it('guards model download interception behind the bridge remote check', () => {
    expect(script).toContain('window.__comfyDesktop2.isRemote()')
    expect(script).toContain('if (!isRemote)')
    expect(script).not.toContain('__comfyDesktop2Remote')
  })

  it('routes captured downloads through window.__comfyDesktop2.downloadModel', () => {
    expect(script).toContain('downloadModel')
  })

  it('contains scrapeErrorsTab function for right side panel missing models', () => {
    expect(script).toContain('scrapeErrorsTab')
  })

  it('scrapes the missing-model error group via stable data-testid hooks', () => {
    expect(script).toContain('scrapeMissingModelErrorGroup')
    expect(script).toContain('[data-testid="error-group-missing-model"]')
    expect(script).toContain('[data-testid="missing-model-actions"]')
  })

  it('detects the legacy properties panel via data-testid as a fallback', () => {
    expect(script).toContain('[data-testid="properties-panel"]')
  })

  it('extracts directory names from category headers with destructive style', () => {
    expect(script).toContain('text-destructive-background-hover')
  })

  it('tracks errorsTabWasOpen state separately from dialogWasOpen', () => {
    expect(script).toContain('errorsTabWasOpen')
    expect(script).toContain('dialogWasOpen')
  })

  it('only clears modelNameCache when both dialog and errors tab are closed', () => {
    const occurrences = script.split('modelNameCache = {}').length - 1
    expect(occurrences).toBeGreaterThanOrEqual(2)
  })

  it('does not inject the in-page downloads UI', () => {
    // The downloads affordance lives in the title-bar tray, so these DOM IDs
    // and the progress listener must NOT appear in the injected script.
    expect(script).not.toContain('__comfy-dl-tab')
    expect(script).not.toContain('__comfy-dl-toasts')
    expect(script).not.toContain('__comfy-dl-cardlist')
    expect(script).not.toContain('__comfy-dl-dock')
    expect(script).not.toContain('onDownloadProgress')
    expect(script).not.toContain('comfy-menu-bg')
  })

  it('still intercepts remote/cloud workflow outputs for auto-download', () => {
    expect(script).toContain('downloadAsset')
    expect(script).toContain('window.WebSocket')
  })

  it('auto-downloads 3D outputs (SaveGLB) alongside images/audio/video', () => {
    // SaveGLB emits results under ui={"3d": [...]}, and the WebSocket intercept
    // iterates a fixed key list, so "3d" must be present or .glb files silently
    // fail to download from cloud/remote sessions.
    expect(script).toContain(`['images', 'gifs', 'audio', 'video', '3d']`)
  })
})

describe('missing-model error group interception (behavioral)', () => {
  const origCreateElement = document.createElement.bind(document)

  afterEach(() => {
    document.createElement = origCreateElement
    document.body.innerHTML = ''
    delete (window as unknown as Record<string, unknown>).__comfyDesktop2Injected
    delete (window as unknown as Record<string, unknown>).__comfyDesktop2
  })

  function flushObserver() {
    return new Promise((resolve) => setTimeout(resolve, 0))
  }

  // Build the right-side-panel missing-model group the way the frontend renders
  // it, but wrap every translatable label in a non-English string. Only the raw
  // directory ("loras") and the model filename (the `title` attr) are read, so a
  // correct mapping here proves the scrape survives i18n.
  function buildLocalizedErrorGroup(directory: string, modelName: string) {
    document.body.innerHTML = `
      <div data-testid="error-group-missing-model">
        <div class="card">
          <div data-testid="missing-model-actions">
            <button data-testid="missing-model-download-all">Alles herunterladen</button>
          </div>
          <div class="category">
            <div class="header"><p><span>${directory} (1)</span></p></div>
            <div class="rows">
              <div class="row">
                <p title="${modelName}">${modelName} (1)</p>
                <button data-testid="missing-model-download" aria-label="Herunterladen ${modelName}">
                  Herunterladen
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `
  }

  it('routes a localized missing-model download with the raw directory', async () => {
    const downloadModel = vi.fn().mockResolvedValue(true)
    ;(window as unknown as Record<string, unknown>).__comfyDesktop2 = {
      isRemote: () => false,
      downloadModel
    }

    buildLocalizedErrorGroup('loras', 'my_lora.safetensors')

    new Function(getModelDownloadContentScript())()

    // The script only scrapes on mutation; nudge the observer, then let it run.
    document.body.appendChild(document.createElement('div'))
    await flushObserver()

    const link = document.createElement('a')
    link.href = 'https://huggingface.co/repo/resolve/main/my_lora.safetensors'
    link.download = 'my_lora.safetensors'
    link.click()

    expect(downloadModel).toHaveBeenCalledWith(
      'https://huggingface.co/repo/resolve/main/my_lora.safetensors',
      'my_lora.safetensors',
      'loras'
    )
  })
})

describe('remote output auto-download intercept (behavioral)', () => {
  const origWebSocket = (window as unknown as Record<string, unknown>).WebSocket

  class FakeWebSocket {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3
    static instances: FakeWebSocket[] = []
    url: string
    private listeners: Array<(ev: { data: string }) => void> = []
    constructor(url: string) {
      this.url = url
      FakeWebSocket.instances.push(this)
    }
    addEventListener(type: string, fn: (ev: { data: string }) => void) {
      if (type === 'message') this.listeners.push(fn)
    }
    emit(msg: unknown) {
      for (const fn of [...this.listeners]) fn({ data: JSON.stringify(msg) })
    }
  }

  afterEach(() => {
    ;(window as unknown as Record<string, unknown>).WebSocket = origWebSocket
    FakeWebSocket.instances = []
    delete (window as unknown as Record<string, unknown>).__comfyDesktop2Injected
    delete (window as unknown as Record<string, unknown>).__comfyDesktop2
  })

  function setup() {
    const downloadAsset = vi.fn().mockResolvedValue(true)
    ;(window as unknown as Record<string, unknown>).WebSocket = FakeWebSocket
    ;(window as unknown as Record<string, unknown>).__comfyDesktop2 = {
      isRemote: () => true,
      downloadModel: vi.fn(),
      downloadAsset
    }
    new Function(getModelDownloadContentScript())()
    return { downloadAsset }
  }

  function connect(url: string): FakeWebSocket {
    const Ws = (window as unknown as { WebSocket: new (url: string) => unknown }).WebSocket
    new Ws(url)
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!
  }

  function executedMsg(promptId: string, filename: string) {
    return {
      type: 'executed',
      data: {
        node: '9',
        prompt_id: promptId,
        output: { images: [{ filename, subfolder: '', type: 'output' }] }
      }
    }
  }

  it('downloads a delivered output exactly once even if the event repeats', () => {
    const { downloadAsset } = setup()
    const ws = connect('ws://remote.example/ws?token=abc')
    // Same executed event delivered twice (e.g. a replay after a reconnect).
    ws.emit(executedMsg('p1', 'img.png'))
    ws.emit(executedMsg('p1', 'img.png'))
    expect(downloadAsset).toHaveBeenCalledTimes(1)
    expect(downloadAsset).toHaveBeenCalledWith(
      'http://remote.example/api/view?filename=img.png&type=output',
      'img.png',
      'abc'
    )
  })

  it('dedupes one event observed by two sockets', () => {
    const { downloadAsset } = setup()
    const a = connect('ws://remote.example/ws')
    const b = connect('ws://remote.example/ws')
    a.emit(executedMsg('p1', 'img.png'))
    b.emit(executedMsg('p1', 'img.png'))
    expect(downloadAsset).toHaveBeenCalledTimes(1)
  })

  it('still downloads outputs of a new prompt with the same filename', () => {
    const { downloadAsset } = setup()
    const ws = connect('ws://remote.example/ws')
    ws.emit(executedMsg('p1', 'img.png'))
    ws.emit(executedMsg('p2', 'img.png'))
    expect(downloadAsset).toHaveBeenCalledTimes(2)
  })
})
