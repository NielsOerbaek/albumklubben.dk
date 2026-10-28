// @vitest-environment jsdom
import { render } from 'lit-html'
import { afterEach, describe, expect, it } from 'vitest'
import { faceTemplate, initials, type Face } from '../../web/src/face.ts'

const who = (over: Partial<Face> = {}): Face =>
  ({ sub: 'sub-9', name: 'Niels Ørbæk Chemnitz', picture: 'https://theta.test/avatars/9.jpg', ...over })

function draw(face: Face, size?: number) {
  const el = document.createElement('div')
  document.body.append(el)
  render(faceTemplate(face, size), el)
  return el.querySelector('.face') as HTMLElement
}

afterEach(() => { document.body.innerHTML = '' })

describe('initialer', () => {
  it('takes the first letter of the first and the last name', () => {
    expect(initials('Niels Ørbæk Chemnitz')).toBe('NC')
    expect(initials('Kate Bush')).toBe('KB')
  })

  it('takes one letter when there is one word, and says nothing of a nameless member', () => {
    expect(initials('Kate')).toBe('K')
    expect(initials('   ')).toBe('?')
  })

  it('counts a letter outside ASCII as one letter', () => {
    expect(initials('Øvrige Ægir')).toBe('ØÆ')
  })
})

describe('et ansigt', () => {
  it('shows the picture Theta has, with the initials underneath it', () => {
    const el = draw(who())
    expect(el.querySelector('img')?.getAttribute('src')).toBe('https://theta.test/avatars/9.jpg')
    expect(el.querySelector('.face-initials')?.textContent).toBe('NC')
  })

  it('is only the initials when Theta has no picture', () => {
    const el = draw(who({ picture: null }))
    expect(el.querySelector('img')).toBeNull()
    expect(el.querySelector('.face-initials')?.textContent).toBe('NC')
  })

  it('hides a picture that will not load, so the initials are what is left', () => {
    const el = draw(who())
    const img = el.querySelector('img') as HTMLImageElement
    img.dispatchEvent(new Event('error'))
    expect(img.style.display).toBe('none')
  })

  it('does not announce itself twice: the picture is decorative, the name is in the text', () => {
    const el = draw(who())
    expect(el.querySelector('img')?.getAttribute('alt')).toBe('')
    expect(el.querySelector('.face-initials')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('asks the browser not to tell Theta which page the face is on', () => {
    expect(draw(who()).querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer')
  })

  it('gives each member a colour of their own, and the same one every time', () => {
    const hue = (sub: string) => draw(who({ sub })).style.getPropertyValue('--face-hue')
    expect(hue('sub-1')).toBe(hue('sub-1'))
    expect(hue('sub-1')).not.toBe(hue('sub-2'))
  })

  it('is drawn at the size it is asked for', () => {
    expect(draw(who(), 16).style.getPropertyValue('--face-size')).toBe('16px')
  })
})
