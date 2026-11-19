import { describe, expect, it } from 'vitest'

import { isPartnerRefusal } from './partnerRefusal'

const BYTEPLUS_REFUSAL = JSON.stringify({
  id: 'cgt-20261118-0001',
  model: 'seedance-1-0-pro',
  status: 'failed',
  error: {
    code: 'OutputVideoSensitiveContentDetected',
    message: 'The request failed because the output video may contain sensitive information.'
  }
})

const BYTEPLUS_AUDIO_REFUSAL = JSON.stringify({
  id: 'cgt-20261118-0002',
  status: 'failed',
  error: {
    code: 'OutputAudioSensitiveContentDetected.PolicyViolation',
    message: 'The output audio may contain sensitive information.'
  }
})

describe('isPartnerRefusal', () => {
  it.each([
    [
      'a failed task whose poll answer has a BytePlus sensitive content code',
      `Task failed: ${BYTEPLUS_REFUSAL}`
    ],
    [
      'a failed task wrapped by the polling loop',
      `Polling aborted due to error: Task failed: ${BYTEPLUS_AUDIO_REFUSAL}`
    ],
    [
      'an API error whose type is a content policy violation',
      'API Error: Your request was rejected as a result of our safety system. (Type: content_policy_violation)'
    ],
    [
      'a ByteDance request error with a sensitive content code',
      'ByteDance request failed. Code: InputImageSensitiveContentDetected, message: The request failed because the input image may contain sensitive information.'
    ],
    [
      'a task the partner moderated',
      'Task failed: {"id": "task-1", "status": "Request Moderated", "result": null}'
    ],
    ['a task whose status is nsfw', 'Task failed: {"id": "task-2", "status": "NSFW"}'],
    [
      'a task with a safety failure code',
      'Polling aborted due to error: Task failed: {"status": "FAILED", "failureCode": "SAFETY.INPUT.IMAGE"}'
    ],
    [
      'a refusal phrase',
      'Task failed: {"task_status": "failed", "task_status_msg": "Failure to pass the risk control system"}'
    ],
    ['a content filter finish reason', 'API Error: {"finish_reason": "content_filter"}']
  ])('says yes for %s', (_what, message) => {
    expect(isPartnerRefusal(message)).toBe(true)
  })

  it.each([
    ['a CUDA out of memory error', 'CUDA out of memory. Tried to allocate 2.00 GiB'],
    ['a missing key', "'clip_vision'"],
    [
      'a failed task with a service error code',
      'Task failed: {"status": "failed", "error": {"code": "InternalServiceError", "message": "The service encountered an unexpected internal error."}}'
    ],
    [
      'a polling timeout',
      'Polling aborted due to error: Polling timed out after 160 non-queued attempts (~1600s of active polling).'
    ],
    [
      'a rate limit',
      'Rate Limit Exceeded: The server returned 429 after all retry attempts. Please wait and try again.'
    ],
    ['a model that names safety', 'Error loading safety_checker: file not found'],
    ['a model file that names nsfw', 'No such file: models/checkpoints/nsfw_v2.safetensors'],
    ['an empty message', ''],
    ['no message', undefined],
    ['a message that is not text', 42]
  ])('says no for %s', (_what, message) => {
    expect(isPartnerRefusal(message)).toBe(false)
  })
})
