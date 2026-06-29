import { resolveDbUrl } from './config';
test('preview env prefers PREVIEW_DATABASE_URL', () => {
  expect(resolveDbUrl({ VERCEL_ENV: 'preview', PREVIEW_DATABASE_URL: 'p', DATABASE_URL: 'd' })).toBe('p');
});
test('non-preview falls through DATABASE_URL -> POSTGRES_URL -> non-pooling chain', () => {
  expect(resolveDbUrl({ DATABASE_URL: 'd', POSTGRES_URL: 'pg' })).toBe('d');
  expect(resolveDbUrl({ POSTGRES_URL: 'pg' })).toBe('pg');
  expect(resolveDbUrl({ POSTGRES_URL_NON_POOLING: 'np' })).toBe('np');
  expect(resolveDbUrl({ DATABASE_URL_UNPOOLED: 'un' })).toBe('un');
  expect(resolveDbUrl({ POSTGRES_URL_NO_SSL: 'ns' })).toBe('ns');
});
test('throws a clear error when no url is configured', () => {
  expect(() => resolveDbUrl({})).toThrow(/no database url/i);
});
