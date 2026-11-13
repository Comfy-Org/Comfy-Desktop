import { describe, expect, it } from 'vitest'

import { idpCallbackFailure, SignInFailure, signInFailureReport } from './signInFailure'

describe('signInFailureReport', () => {
  it.each<[string, unknown, Record<string, unknown>]>([
    [
      'a sign-in the person declined',
      idpCallbackFailure('access_denied'),
      { reason: 'cancelled', oauth_error: 'access_denied' }
    ],
    [
      'a request Cloud rejected at the authorize step',
      idpCallbackFailure('invalid_scope'),
      { reason: 'idp_error', oauth_error: 'invalid_scope' }
    ],
    [
      'a callback error this build does not know',
      idpCallbackFailure('user a@example.com is suspended'),
      { reason: 'idp_error', oauth_error: 'other' }
    ],
    [
      'a refused token request',
      new SignInFailure('refused', 'server_error', {
        httpStatus: 400,
        oauthError: 'invalid_grant'
      }),
      { reason: 'server_error', http_status: 400, oauth_error: 'invalid_grant' }
    ],
    [
      'a token request that failed with no OAuth error',
      new SignInFailure('unavailable', 'server_error', { httpStatus: 503 }),
      { reason: 'server_error', http_status: 503 }
    ],
    [
      'a request that never reached Cloud',
      new SignInFailure('offline', 'network'),
      { reason: 'network' }
    ],
    ['anything that is not a sign-in failure', new Error('EADDRINUSE'), { reason: 'unknown' }]
  ])('reports %s', (_name, error, report) => {
    expect(signInFailureReport(error)).toEqual(report)
  })
})
