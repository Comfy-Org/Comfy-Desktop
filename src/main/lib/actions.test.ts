import { describe, expect, it } from 'vitest'
import en from '../../../locales/en.json'
import { deleteAction, untrackAction } from './actions'

describe('Forget build', () => {
  it('is a neutral action, since the build folder stays and it can be added again', () => {
    expect(untrackAction().style).toBe('default')
  })

  it('asks first, and its confirm says the folder stays and how to add it back', () => {
    const forget = untrackAction()
    expect(forget.confirm?.message).toBe('actions.untrackConfirmMessage')
    expect(en.actions.untrack).toBe('Forget')
    expect(en.actions.untrackConfirmMessage).toContain('folder stays on your computer')
    expect(en.actions.untrackConfirmMessage).toContain(en.chooser.addExistingBuild)
  })

  it('tells a remote connection it leaves the app and how to connect again, with no folder', () => {
    const forget = untrackAction('remoteConnection')
    expect(forget.style).toBe('default')
    expect(forget.confirm?.message).toBe('actions.untrackRemoteConfirmMessage')
    expect(en.actions.untrackRemoteConfirmMessage).toContain('removes the connection')
    expect(en.actions.untrackRemoteConfirmMessage).toContain(en.newInstall.startFromServer)
    expect(en.actions.untrackRemoteConfirmMessage).not.toContain('folder')
  })
})

describe('Uninstall', () => {
  it('stays the danger action, since it deletes the build files', () => {
    expect(deleteAction({ installPath: '/builds/flux' }).style).toBe('danger')
  })
})
