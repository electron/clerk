import { expect } from 'chai';
import 'mocha';

import { getReleaseNotes } from '../src/parsing'

describe('getReleaseNotes', () => {
  it('should remove comments', () => {
    expect(getReleaseNotes(`Notes: <!-- test --> some notes`)).to.equal('some notes')
    expect(getReleaseNotes(`Notes: some <!-- test --> notes`)).to.equal('some  notes')
    expect(getReleaseNotes(`Notes: some notes <!-- test -->`)).to.equal('some notes')
    expect(getReleaseNotes(`Notes: <!--a--> some <!--b--> notes <!--c-->`)).to.equal('some  notes')
  })
  it('should be case insensitive', () => {
    expect(getReleaseNotes(`notes: some notes`)).to.equal('some notes')
    expect(getReleaseNotes(`NOTES: some notes`)).to.equal('some notes')
    expect(getReleaseNotes(`nOtEs: some notes`)).to.equal('some notes')
  })
  it('should match only the first notes line present', () => {
    expect(getReleaseNotes(`notes: a\nnotes: b`)).to.equal('a')
  })
  it('should match a notes line anywhere in the body', () => {
    expect(getReleaseNotes(`a\nnotes: some notes\nb`)).to.equal('some notes')
    expect(getReleaseNotes(`a\nb\nnotes: some notes\n`)).to.equal('some notes')
    expect(getReleaseNotes(`notes: some notes\na\nb\n`)).to.equal('some notes')
  })
  it('should be resilient to various newline schemes', () => {
    expect(getReleaseNotes(`a\r\nnotes: some notes\r\n`)).to.equal('some notes')
    expect(getReleaseNotes(`a\nnotes: some notes\n`)).to.equal('some notes')
  })
  it('should return null if there are no notes present', () => {
    expect(getReleaseNotes(`no notes here`)).to.be.null
    expect(getReleaseNotes(`empty notes\nnotes: \n`)).to.be.null
    expect(getReleaseNotes(`empty notes\nnotes:  \n`)).to.be.null
    expect(getReleaseNotes(`comment-only notes\nnotes:  <!-- test --> \n`)).to.be.null
  })
  it('should parse multi-line notes', () => {
    expect(getReleaseNotes(`multiline
notes:
* one
* two
`
    )).to.equal('* one\n* two')
    expect(getReleaseNotes(`multiline
notes:
* one

* not part of the notes
`
    )).to.equal('* one')
  })
})
