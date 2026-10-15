import { BrowserWindow, session } from 'electron'
import type { WebContents } from 'electron'
import type { InstallationRecord } from '../installations'
import { expectedPartitionFor } from '../host/partition'
import { templateModelAccessUrl } from '../sources/standalone/templateModelAccess'
import { openModelAccessPageWindow } from './modelAccessPage'

export async function openPerformanceTestModelAccess(
  sender: WebContents,
  installation: InstallationRecord,
  templateId: string
): Promise<boolean> {
  const url = templateModelAccessUrl(templateId)
  const parent = BrowserWindow.fromWebContents(sender)
  if (!url || !parent || parent.isDestroyed()) return false
  return openModelAccessPageWindow(sender, url, {
    parent,
    session: session.fromPartition(expectedPartitionFor(installation))
  })
}
