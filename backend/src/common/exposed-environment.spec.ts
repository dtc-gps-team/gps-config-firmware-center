import { isExposedEnvironment } from './exposed-environment';

describe('isExposedEnvironment', () => {
  it.each([
    [{}, false],
    [{ NODE_ENV: 'development' }, false],
    [{ NODE_ENV: 'test' }, false],
    [{ TRUST_PROXY: '' }, false],
    [{ TRUST_PROXY: '0' }, false],
    [{ TRUST_PROXY: 'false' }, false],
    [{ NODE_ENV: 'production' }, true],
    [{ TRUST_PROXY: '1' }, true],
    [{ NODE_ENV: 'development', TRUST_PROXY: '2' }, true],
  ])('env %p -> %p', (env, expected) => {
    expect(isExposedEnvironment(env)).toBe(expected);
  });
});
