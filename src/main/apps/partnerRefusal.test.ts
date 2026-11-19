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

const LUMA_SERVICE_FAILURE =
  'Polling aborted due to error: Task failed: {"id": "gen-1", "generation_type": "image", "state": "failed", ' +
  '"failure_reason": "Internal service error", "created_at": "2026-11-19T10:00:00Z", "assets": null, ' +
  '"model": "photon-1", "request": {"prompt": "A poster saying content moderated", "model": "photon-1", ' +
  '"aspect_ratio": "16:9"}}\n'

function nestedArrays(depth: number, inner = ''): string {
  return `${'['.repeat(depth)}${inner}${']'.repeat(depth)}`
}

const DEEP_TEXT_ANSWER = `Gemini answered with text: {"result": ${nestedArrays(20_000)}}`

describe('isPartnerRefusal', () => {
  it.each([
    [
      'a failed task whose poll answer has a BytePlus sensitive content code',
      `Task failed: ${BYTEPLUS_REFUSAL}`
    ],
    [
      'a failed task wrapped by the polling loop',
      `Polling aborted due to error: Task failed: ${BYTEPLUS_REFUSAL}\n`
    ],
    [
      'a refusal code next to an echoed request',
      'Task failed: {"status": "failed", "request": {"prompt": "a cat"}, "error": {"code": "InputTextSensitiveContentDetected"}}\n'
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
    ['a content filter finish reason', 'API Error: {"finish_reason": "content_filter"}'],
    [
      "the Seedance node's message for a refused audio track",
      'The provider rejected the audio track this model generated for the video (possible copyright match). The video itself was fine. Turn off generate_audio to get a silent video, or adjust the prompt and try again.\n'
    ],
    [
      "the Hunyuan node's message for a content filter stop",
      'Tencent blocked this request with its content filter.\n'
    ],
    [
      "the Gemini node's message for prohibited image content",
      "Gemini API blocked the request. Reasons: ['IMAGE_PROHIBITED_CONTENT']\n"
    ],
    [
      "the Gemini node's message for a blocked prompt",
      'Gemini API blocked the request. Reason: SAFETY (None)\n'
    ],
    [
      "the Anthropic node's message for a refusal stop",
      'Claude declined to answer this request for safety reasons. Rephrase the prompt or try a different model.\n'
    ],
    [
      "the Ideogram node's message for an unsafe image",
      "The generation was blocked by Ideogram's content safety filter. Adjust the prompt and try again.\n"
    ],
    [
      "the Veo node's message for filtered videos",
      "Content blocked by Google's Responsible AI filters: Unsafe content detected (1 video filtered).\n"
    ],
    [
      "an LLM node's message for a model refusal",
      "Model refused to respond: I can't help with that.\n"
    ]
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
    ['a Luma service failure whose echoed prompt names a moderation status', LUMA_SERVICE_FAILURE],
    [
      'a failure whose echoed prompt quotes a refusal phrase',
      'Task failed: {"status": "failed", "prompt": "a sign that violates our content policy", "error": {"code": "InternalServiceError"}}\n'
    ],
    [
      'a failure whose echoed input names a refusal code',
      'Task failed: {"status": "failed", "input": {"negative_prompt": "content_filter, blurry"}, "failure_reason": "timeout"}\n'
    ],
    [
      'a request echoed inside a JSON string',
      'API Error: {"detail": "{\\"request\\": {\\"prompt\\": \\"request moderated\\"}}", "code": 500}\n'
    ],
    ['a model that names safety', 'Error loading safety_checker: file not found'],
    ['a model file that names nsfw', 'No such file: models/checkpoints/nsfw_v2.safetensors'],
    ['a text answer of 20,000 nested arrays', DEEP_TEXT_ANSWER],
    [
      'a refusal code nested deeper than the classifier reads',
      `Task failed: {"result": ${nestedArrays(100, '"content_filter"')}}`
    ],
    ['a message too long to classify, even one naming a refusal', 'content_filter '.repeat(2_000)],
    ['an empty message', ''],
    ['no message', undefined],
    ['a message that is not text', 42]
  ])('says no for %s', (_what, message) => {
    expect(isPartnerRefusal(message)).toBe(false)
  })

  it('does not throw for a text answer of 20,000 nested arrays', () => {
    expect(() => isPartnerRefusal(DEEP_TEXT_ANSWER)).not.toThrow()
  })

  it('finds a refusal code next to an array nested deeper than the classifier reads', () => {
    expect(
      isPartnerRefusal(
        `Task failed: {"error": {"code": "content_filter"}, "result": ${nestedArrays(5_000)}}`
      )
    ).toBe(true)
  })
})
