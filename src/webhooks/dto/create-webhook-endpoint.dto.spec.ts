import { validate } from 'class-validator';
import { CreateWebhookEndpointDto } from './create-webhook-endpoint.dto';

describe('CreateWebhookEndpointDto', () => {
  it('passes validation with valid data', async () => {
    const dto = new CreateWebhookEndpointDto();
    dto.url = 'https://example.com/webhook';
    dto.events = 'ticket.issued';
    dto.secret = 'my-secret-key';

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('fails validation when url is invalid', async () => {
    const dto = new CreateWebhookEndpointDto();
    dto.url = 'invalid-url';

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('url');
  });
});
