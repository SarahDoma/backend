import { assertWebhookUrl } from './webhook-queue';
import { DisabledWebhookQueue } from './disabled-webhook-queue';

describe('assertWebhookUrl', () => {
  it.each(['https://example.com/hooks', 'http://localhost:4000/h?x=1'])(
    'accepts %s',
    (url) => {
      expect(() => assertWebhookUrl(url)).not.toThrow();
    },
  );

  it.each(['not a url', 'ftp://example.com/x', 'file:///etc/passwd', ''])(
    'rejects %p',
    (url) => {
      expect(() => assertWebhookUrl(url)).toThrow(TypeError);
    },
  );
});

describe('DisabledWebhookQueue', () => {
  it('reports that nothing was queued', async () => {
    expect(await new DisabledWebhookQueue().enqueue()).toBe(false);
  });
});
