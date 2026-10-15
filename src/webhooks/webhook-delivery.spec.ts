import { deliverWebhook } from './webhook-delivery';

const delivery = {
  url: 'https://example.com/hooks',
  event: 'ticket.issued',
  payload: { ticketId: 't-1' },
};

function fetchReturning(status: number) {
  return jest
    .fn()
    .mockResolvedValue({ ok: status >= 200 && status < 300, status });
}

describe('deliverWebhook', () => {
  it('POSTs the event and payload as JSON', async () => {
    const fetchImpl = fetchReturning(200);

    await deliverWebhook(delivery, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.com/hooks');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      'x-webhook-event': 'ticket.issued',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      event: 'ticket.issued',
      payload: { ticketId: 't-1' },
    });
  });

  it('does not follow redirects and bounds the request with a timeout', async () => {
    const fetchImpl = fetchReturning(204);

    await deliverWebhook(delivery, { fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([301, 400, 404, 500, 503])(
    'throws on HTTP %i so the queue retries',
    async (status) => {
      await expect(
        deliverWebhook(delivery, { fetchImpl: fetchReturning(status) }),
      ).rejects.toThrow(`HTTP ${status}`);
    },
  );

  it('propagates network errors so the queue retries', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNRESET'));

    await expect(deliverWebhook(delivery, { fetchImpl })).rejects.toThrow(
      'ECONNRESET',
    );
  });

  it('includes x-webhook-signature header when secret is provided', async () => {
    const fetchImpl = fetchReturning(200);
    const deliveryWithSecret = {
      ...delivery,
      secret: 'my-secret-key',
    };

    await deliverWebhook(deliveryWithSecret, { fetchImpl });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-webhook-signature']).toBeDefined();
    expect(headers['x-webhook-signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
  });
});
