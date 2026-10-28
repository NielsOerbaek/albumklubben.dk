import { describe, expect, it } from 'vitest'
import { openDb } from '../../server/db.ts'
import { faces, picturesOf, pictureUrl, rememberMember } from '../../server/members.ts'

const ISSUER = 'https://theta.test/oidc'

describe('billedet fra Theta', () => {
  it('takes an absolute https url as it is', () => {
    expect(pictureUrl('https://theta.test/avatars/9.jpg', ISSUER)).toBe('https://theta.test/avatars/9.jpg')
  })

  it('resolves a relative url against Theta, not against us', () => {
    expect(pictureUrl('/avatars/9.jpg', ISSUER)).toBe('https://theta.test/avatars/9.jpg')
  })

  it('refuses anything that is not http or https', () => {
    expect(pictureUrl('javascript:alert(1)', ISSUER)).toBeNull()
    expect(pictureUrl('data:image/svg+xml,<svg onload="alert(1)"/>', ISSUER)).toBeNull()
  })

  it('is nothing when Theta sends nothing', () => {
    expect(pictureUrl(undefined, ISSUER)).toBeNull()
    expect(pictureUrl('', ISSUER)).toBeNull()
    expect(pictureUrl('  ', ISSUER)).toBeNull()
    expect(pictureUrl(42, ISSUER)).toBeNull()
  })
})

describe('at huske et medlem', () => {
  it('keeps the name and the picture, and the newest login wins', () => {
    const db = openDb(':memory:')
    rememberMember(db, { sub: 's1', name: 'Medlem Een', picture: 'https://theta.test/a/1.jpg' })
    rememberMember(db, { sub: 's1', name: 'Medlem Een Til', picture: 'https://theta.test/a/2.jpg' })
    expect(picturesOf(db, ['s1']).get('s1')).toBe('https://theta.test/a/2.jpg')
    expect(db.prepare('SELECT name FROM members WHERE sub = ?').get('s1')).toEqual({ name: 'Medlem Een Til' })
  })

  it('forgets a picture a member has taken down', () => {
    const db = openDb(':memory:')
    rememberMember(db, { sub: 's1', name: 'Medlem Een', picture: 'https://theta.test/a/1.jpg' })
    rememberMember(db, { sub: 's1', name: 'Medlem Een', picture: null })
    expect(picturesOf(db, ['s1']).has('s1')).toBe(false)
  })

  it('says nothing about a member who has not logged in since', () => {
    const db = openDb(':memory:')
    expect(picturesOf(db, ['ukendt']).size).toBe(0)
    expect(picturesOf(db, []).size).toBe(0)
  })
})

describe('at sætte ansigt på', () => {
  it('fills in each person, and leaves the ones we do not know of as they are', () => {
    const db = openDb(':memory:')
    rememberMember(db, { sub: 's1', name: 'Medlem Een', picture: 'https://theta.test/a/1.jpg' })
    const face = faces(db, ['s1', 's2'])
    // The name on the row stays: it is the one the member had when they wrote.
    expect(face.of({ sub: 's1', name: 'Medlem Een, dengang' }))
      .toEqual({ sub: 's1', name: 'Medlem Een, dengang', picture: 'https://theta.test/a/1.jpg' })
    expect(face.of({ sub: 's2', name: 'Medlem To' }))
      .toEqual({ sub: 's2', name: 'Medlem To', picture: null })
  })
})
