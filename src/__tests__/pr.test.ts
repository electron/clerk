import { getTargetVersions } from '../pr';

describe('target versions', () => {
  it('bumps patch', () => {
    expect(getTargetVersions('4.0.4')).toEqual(['4.0.5']);
    expect(getTargetVersions('3.1.0')).toEqual(['3.1.1']);
  });
  it('targets beta.n+1 + release for prs against a beta branch', () => {
    expect(getTargetVersions('5.0.0-beta.1')).toEqual(['5.0.0-beta.2', '5.0.0']);
    expect(getTargetVersions('3.1.0-beta.4')).toEqual(['3.1.0-beta.5', '3.1.0']);
  });
  it('targets beta.1 + release for prs against a nightly branch', () => {
    expect(getTargetVersions('6.0.0-nightly.20190214')).toEqual(['6.0.0-beta.1', '6.0.0']);
  });
});
